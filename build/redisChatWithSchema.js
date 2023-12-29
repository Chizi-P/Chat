import { createClient } from 'redis';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { EntityId } from 'redis-om';
import { createRepositories } from './schema.js';
// 單例
function Singleton(Class) {
    let instance;
    return (...args) => instance || (instance = new Class(...args));
}
var ChatEvents;
(function (ChatEvents) {
    ChatEvents["SendMessage"] = "sendMessage";
    ChatEvents["FriendInvitation"] = "friendInvitation";
    // FriendConfirmation     = 'friendConfirmation',  // 確認好友關係
    ChatEvents["GroupInvitation"] = "groupInvitation";
    // GroupConfirmation      = 'groupConfirmation',   // 確認加入群組
})(ChatEvents || (ChatEvents = {}));
var ChatError;
(function (ChatError) {
    ChatError["EmailAlreadyExists"] = "EmailAlreadyExists";
    ChatError["InvalidEmail"] = "InvalidEmail";
    ChatError["InvalidUsername"] = "InvalidUsername";
    ChatError["WeakPassword"] = "WeakPassword";
    ChatError["InvalidPassword"] = "InvalidPassword";
    ChatError["ServerError"] = "ServerError";
    ChatError["CaptchaError"] = "CaptchaError";
    ChatError["TermsNotAccepted"] = "TermsNotAccepted";
    ChatError["UserNotFound"] = "UserNotFound";
    ChatError["AccountOrPasswordError"] = "AccountOrPasswordError";
    ChatError["TokenValidationError"] = "TokenValidationError";
})(ChatError || (ChatError = {}));
class ChatBase {
    db;
    redisOptions; // FIXME: use options
    repos;
    options;
    isSavingLog = true;
    isShowingLog = true;
    isLogWithTable = true;
    constructor(options, redisOptions) {
        this.redisOptions = redisOptions;
        this.options = options;
        this.db = createClient();
        this.db.on('error', err => this.logger('Redis Client Error', err));
        this.db.on('connect', () => this.logger('Redis client connected'));
        this.db.on('end', () => this.logger('Redis client disconnected'));
        this.repos = createRepositories(this.db);
        this.connect().then(() => {
            Object.entries(this.repos).forEach(([key, val]) => {
                val.createIndex().then(() => this.logger(`Index of ${key} created successfully`));
            });
        });
    }
    async push(repoKey, id, key, ...pushData) {
        let obj = await this.repos[repoKey].fetch(id);
        obj[key].push(...pushData);
        return await this.repos[repoKey].save(obj);
    }
    async remove(repoKey, id, key, ...removeData) {
        let obj = await this.repos[repoKey].fetch(id);
        obj[key] = obj[key].filter(e => !(e in removeData));
        return await this.repos[repoKey].save(obj);
    }
    events = {
        [ChatEvents.FriendInvitation]: {
            action: async (task) => {
                this.logger('FriendInvitation task action');
                this.logger(task);
                const { from, to, content, eventType } = task;
                // 發送通知
                await this.notify(from, to, content, eventType);
                return task;
            },
            finish: async (task) => {
                this.logger('FriendInvitation task finish');
                const { from, to, content, eventType } = task;
                const groupID = await this.createDirectGroup(from, to);
                await this.push('user', from, 'friends', groupID);
                await this.push('user', to, 'friends', groupID);
                // 發送通知
                await this.notify(from, to, content, eventType);
                return groupID;
            }
        },
        [ChatEvents.GroupInvitation]: {
            action: async (task) => {
                this.logger('GroupInvitation action');
                this.logger(task);
                const { from, to, content, eventType } = task;
                // 發送通知
                await this.notify(from, to, content, eventType);
                return task;
            },
            finish: async (task) => {
                const { from, to, content, eventType } = task;
                await this.push('user', to, 'groups', from);
                await this.push('group', from, 'members', to);
                // 發送通知
                await this.notify(from, to, content, eventType);
            }
        }
    };
    registerEvent(name, eventData) {
        this.events[name] = eventData;
    }
    async logger(...log) {
        if (this.isShowingLog) {
            if (typeof log === 'object' && this.isLogWithTable)
                console.table(...log);
            else
                console.log(...log);
        }
        if (this.isSavingLog) {
            await this.db.lPush('logs', JSON.stringify({ log: log.join(' '), createAt: Date.now() }));
        }
    }
    async hash(data) {
        const saltRounds = 10;
        const salt = await bcrypt.genSalt(saltRounds);
        return await bcrypt.hash(data, salt);
    }
    async connect() {
        await this.db.connect();
        return this;
    }
    async disconnect() {
        await this.db.disconnect();
        return this;
    }
    async createUser(name, email, password, otherData) {
        // 檢查 email 是否已經存在
        if (await this.repos.user.search().where('email').eq(email).return.count() > 0)
            return ChatError.EmailAlreadyExists;
        let user = await this.repos.user.save({
            name,
            email,
            hashedPassword: await this.hash(password),
            createAt: new Date(),
            friends: [],
            groups: [],
            notifications: [],
            tasks: [],
            // tracking       : [], // TODO: 試試看 tracking 沒有輸入會有什麼結果
            ...otherData ?? {},
        });
        return user[EntityId];
    }
    async setFactory(obj) {
        return async (key, value) => {
            obj[key] = value;
            return await this.repos.user.save(obj);
        };
    }
    // FIXME - get user data
    // OPT 使用方法和類型
    // async getUser(userID: UserID): Promise<DataWithSet<User>> {
    //     let user = await this.repos.user.fetch(userID) as User
    //     return user
    // }
    async user(userID) {
        let user = await this.repos.user.fetch(userID);
        return { ...user, set: await this.setFactory(user) };
    }
    async group(groupID) {
        let group = await this.repos.user.fetch(groupID);
        return { ...group, set: await this.setFactory(group) };
    }
    async login(tokenOrEmail, password) {
        // login with token
        if (password === undefined) {
            try {
                let user = jwt.verify(tokenOrEmail, this.options.privateKey);
                return { token: tokenOrEmail, userID: user.userID, name: user.name, email: user.email };
            }
            catch (e) {
                console.log(e);
                return { err: ChatError.TokenValidationError };
            }
        }
        // login with email and password
        // 搜尋對應 email 的 user
        let user = await this.repos.user.search().where('email').eq(tokenOrEmail).return.first();
        // 檢測 user 是否存在 和 密碼是否正確
        if (user === null || !await bcrypt.compare(password, user.hashedPassword))
            return { err: ChatError.AccountOrPasswordError };
        const userID = user[EntityId];
        const token = jwt.sign({
            userID: userID,
            name: user.name,
            email: user.email,
            createAt: Date.now(),
        }, this.options.privateKey);
        return { token, userID, name: user.name, email: user.email };
    }
    // 通知
    async notify(from, to, content, eventType) {
        let notification = await this.repos.notification.save({
            from,
            to,
            eventType,
            content,
            createAt: new Date()
        });
        const notificationID = notification[EntityId];
        await this.push('user', from, 'notifications', notificationID);
        return notificationID;
    }
    // async task(taskData: { from: UserID, to: UserID,            eventType: ChatEvents, creator?: UserID, content?: string }): Promise<Awaited<ReturnType<NonNullable<ValueOf<ChatRegisterEvent>['action']>>>[]>
    // async task(taskData: { from: UserID, to: UserID[],          eventType: ChatEvents, creator?: UserID, content?: string }): Promise<Awaited<ReturnType<NonNullable<ValueOf<ChatRegisterEvent>['action']>>>[]>
    async task(taskData) {
        const { from, eventType } = taskData;
        const to = Array.isArray(taskData.to) ? taskData.to : [taskData.to];
        const creator = taskData.creator ?? from;
        const content = taskData.content ?? '';
        let taskIDs = [];
        let eventResults = [];
        to.forEach(async (toUser) => {
            const isExisted = await this.repos.task.search()
                .where('from').eq(from)
                .and('to').eq(toUser)
                .and('eventType').eq(eventType).return.count() > 0;
            // .and('content').eq(content).returnCount() > 0;
            if (isExisted) {
                console.log('task is existed');
                return;
            }
            let task = await this.repos.task.save({
                from,
                to: toUser,
                eventType,
                creator,
                createAt: new Date(),
                content,
            });
            const taskID = task[EntityId];
            await this.push('user', toUser, 'tasks', taskID);
            // 執行 event 對應任務
            const eventResult = await this.events[eventType]?.action?.call(this, task);
            eventResults.push(eventResult);
            taskIDs.push(taskID);
        });
        await this.push('user', from, 'tracking', ...taskIDs);
        return eventResults;
    }
    async cancelTask(taskID) {
        let task = await this.repos.task.fetch(taskID);
        await this.remove('user', task.from, 'tracking', taskID);
        await this.remove('user', task.to, 'tasks', taskID);
        await this.repos.task.remove(taskID);
    }
    async finishTask(taskID) {
        let task = await this.repos.task.fetch(taskID);
        // 根據 task 的 event 執行指定任務
        const eventResult = this.events[task.eventType]?.finish?.call(this, task);
        // 刪除 user from 的跟蹤
        let fromUser = await this.repos.user.fetch(task.from);
        const trackingIndex = fromUser.tracking.indexOf(taskID);
        if (trackingIndex >= 0) {
            fromUser.tracking.splice(trackingIndex, 1);
            await this.repos.user.save(fromUser);
        }
        // 刪除 user to 的任務
        let toUsers = await this.repos.user.fetch(task.to);
        const taskIndex = toUsers.tasks.indexOf(taskID);
        if (taskIndex >= 0) {
            toUsers.tasks.splice(taskIndex, 1);
            await this.repos.user.save(toUsers);
        }
        // 刪除任務
        await this.repos.task.remove(taskID);
        return eventResult;
    }
    async FriendInvitation(from, to) {
        return await this.task({
            from,
            to,
            eventType: ChatEvents.FriendInvitation
        });
    }
    async FriendConfirmation(taskID) {
        return await this.finishTask(taskID);
    }
    async createDirectGroup(user1, user2) {
        let group = await this.repos.group.save({
            creator: 'system',
            createAt: new Date(),
            members: [user1, user2],
            messages: [],
            isDirect: true
        });
        const groupID = group[EntityId];
        return groupID;
    }
    async groupInvitation(inviter, groupID, invitedMembers) {
        if (!invitedMembers.length)
            return;
        return await this.task({
            creator: inviter,
            from: groupID,
            to: invitedMembers,
            eventType: ChatEvents.GroupInvitation,
        });
    }
    async groupConfirmation(taskID) {
        return await this.finishTask(taskID);
    }
    async createGroup(name, creator, avatar, invitedMembers = []) {
        let group = await this.repos.group.save({
            name,
            creator,
            createAt: new Date(),
            avatar,
            members: [creator],
            messages: [],
            isDirect: false
        });
        const groupID = group[EntityId];
        // 儲存到 creator 自己的資料中
        await this.push('user', creator, 'groups', groupID);
        await this.groupInvitation(creator, groupID, invitedMembers);
        return groupID;
    }
    async sendMessage(from, to, content) {
        let message = await this.repos.message.save({
            from,
            to,
            content,
            createAt: new Date(),
            readers: [from]
        });
        const messageID = message[EntityId];
        // FIXME: 兩個方法
        const method = 1;
        if (method === 1) {
            // 1: 直接寫到 group 的 messages 中
            await this.push('group', to, 'messages', messageID);
            // 發送通知
            await this.notify(from, to, content, ChatEvents.SendMessage);
        }
        else if (method === 2) {
            // 2: 寫成 task，等第一個用戶在線再寫到 group 的 messages 中
            await this.task({
                from,
                to,
                creator: from,
                eventType: ChatEvents.SendMessage,
                content
            });
            // 發送通知
            await this.notify(from, to, content, ChatEvents.SendMessage);
        }
        return messageID;
    }
    async readMsg(reader, messageID) {
        return await this.push('message', messageID, 'readers', reader);
    }
    // TODO - 讀取離線消息
    async checkForOfflineMessages(userID) {
        let user = await this.repos.user.fetch(userID);
        return user.notifications;
    }
    async quit() {
        return await this.db.quit();
    }
}
// 生成單例
const Chat = Singleton(ChatBase);
export { Chat, ChatError, ChatEvents, };
