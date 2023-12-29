import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { EntityId } from 'redis-om'

import { RedisDB, RedisDatabase } from './RedisDatabase.js'
import { hash, ValueOf } from './util.js'

import * as cfg from './.config.js'
import type {
    Config,
    UserID,
    GroupID,
    MessageID,
    NotificationID,
    TaskID,
    User,
    Group,
    Message,
    Notification,
    Task,
    ChatRegisterEvent,
    ResultWithChatError,
} from "./DatabaseType.js"
import { ChatEvents, ChatError } from "./DatabaseType.js"


class Controller {

    public db: RedisDatabase

    public config: Config

    constructor(){
        this.config = { privateKey: cfg.privateKey }
        this.db = RedisDB(this.config)
    }
    
    public async log(...message: Parameters<RedisDatabase['log']>): ReturnType<RedisDatabase['log']> {
        await this.db.log(...message)
    }

    // 商業邏輯放呢邊
    
    private events : ChatRegisterEvent = {
        [ChatEvents.FriendInvitation]: {
            action: async task => {
                this.log('FriendInvitation task action')
                this.log(task)
                const { from, to, content, eventType } = task
                // 發送通知
                await this.notify(from, to, content, eventType)
                return task
            },
            finish: async task => {
                this.log('FriendInvitation task finish')
                const { from, to, content, eventType } = task
                const groupID = await this.createDirectGroup(from, to)
                await this.db.push('user', from, 'friends', groupID)
                await this.db.push('user', to, 'friends', groupID)
                // 發送通知
                await this.notify(from, to, content, eventType)
                return groupID
            }
        },
        [ChatEvents.GroupInvitation]: {
            action: async task => {
                this.log('GroupInvitation action')
                this.log(task)
                const { from, to, content, eventType } = task
                // 發送通知
                await this.notify(from, to, content, eventType)
                return task
            },
            finish: async task => {
                const { from, to, content, eventType } = task
                await this.db.push('user', to, 'groups', from)
                await this.db.push('group', from, 'members', to)
                // 發送通知
                await this.notify(from, to, content, eventType)
            }
        }
    }

    registerEvent(name: keyof ChatRegisterEvent, eventData: ValueOf<ChatRegisterEvent>) {
        this.events[name] = eventData
    }
    
    public async createUser(
        name: string, 
        email: string, 
        password: string, 
        otherData?: Record<string, any>
    ): Promise<UserID | ChatError> {
        // 檢查 email 是否已經存在

        if (await this.db.repos.user.search().where('email').eq(email).return.count() > 0) return ChatError.EmailAlreadyExists

        let user = await this.db.repos.user.save({
            name, 
            email, 
            hashedPassword : await hash(password),
            createAt       : new Date(),
            friends        : [],
            groups         : [],
            notifications  : [],
            tasks          : [],
            // tracking       : [], // TODO: 試試看 tracking 沒有輸入會有什麼結果
            ...otherData ?? {},
        }) as User
        return user[EntityId] as UserID
    }

    // 通知
    async notify(from: UserID, to: UserID, content: string, eventType: ChatEvents): Promise<NotificationID> {
        let notification = await this.db.repos.notification.save({
            from, 
            to,
            eventType,
            content,
            createAt: new Date()
        }) as Notification

        const notificationID = notification[EntityId] as NotificationID
        await this.db.push('user', from, 'notifications', notificationID)

        return notificationID
    }

    async login(token: string, password?: string): Promise<ResultWithChatError<{token: string, userID: UserID, name: string, email: string}>>
    async login(email: string, password: string): Promise<ResultWithChatError<{token: string, userID: UserID, name: string, email: string}>>
    async login(tokenOrEmail: string, password: string): Promise<ResultWithChatError<{token: string, userID: UserID, name: string, email: string}>> {
        // login with token
        if (password === undefined) {
            try {
                let user = jwt.verify(tokenOrEmail, this.config.privateKey) as jwt.UserJwtPayload
                return { 
                    token  : tokenOrEmail, 
                    userID : user.userID, 
                    name   : user.name,
                    email  : user.email
                }
            } catch(e) {
                this.log(e as object)
                return { err: ChatError.TokenValidationError }
            }
        }

        // login with email and password
        // 搜尋對應 email 的 user
        let user = await this.db.repos.user.search().where('email').eq(tokenOrEmail).return.first() as User
        // 檢測 user 是否存在 和 密碼是否正確
        if (user === null || !await bcrypt.compare(password, user.hashedPassword)) return { err: ChatError.AccountOrPasswordError }

        const userID = user[EntityId] as UserID

        const token = jwt.sign({
            userID   : userID, 
            name     : user.name, 
            email    : user.email, 
            createAt : Date.now(),
        }, this.config.privateKey)

        return { token, userID, name: user.name, email: user.email }
    }

    
    // async task(taskData: { from: UserID, to: UserID,            eventType: ChatEvents, creator?: UserID, content?: string }): Promise<Awaited<ReturnType<NonNullable<ValueOf<ChatRegisterEvent>['action']>>>[]>
    // async task(taskData: { from: UserID, to: UserID[],          eventType: ChatEvents, creator?: UserID, content?: string }): Promise<Awaited<ReturnType<NonNullable<ValueOf<ChatRegisterEvent>['action']>>>[]>
    async task(taskData: { from: UserID, to: UserID | UserID[], eventType: ChatEvents, creator?: UserID, content?: string }): Promise<Awaited<ReturnType<NonNullable<ValueOf<ChatRegisterEvent>['action']>>>[]> {
        const { from, eventType } = taskData
        const to = Array.isArray(taskData.to) ? taskData.to: [taskData.to]
        const creator = taskData.creator ?? from
        const content = taskData.content ?? ''

        let taskIDs: TaskID[] = []
        let eventResults: Awaited<ReturnType<NonNullable<ValueOf<ChatRegisterEvent>['action']>>>[] = []
        to.forEach(async toUser => {

            const isExisted = await this.db.repos.task.search()
                .where('from').eq(from)
                .and('to').eq(toUser)
                .and('eventType').eq(eventType).return.count() > 0
                // .and('content').eq(content).returnCount() > 0;
            if (isExisted) {
                this.log('task is existed')
                return
            }

            let task = await this.db.repos.task.save({
                from,
                to : toUser,
                eventType,
                creator,
                createAt: new Date(),
                content,
            }) as Task

            const taskID = task[EntityId] as TaskID
            await this.db.push('user', toUser, 'tasks', taskID)
            // 執行 event 對應任務
            const eventResult = await this.events[eventType]?.action?.call(this.db, task)
            eventResults.push(eventResult)
            taskIDs.push(taskID)
        })
        await this.db.push('user', from, 'tracking', ...taskIDs)

        return eventResults
    }
    
    async cancelTask(taskID: TaskID) {
        let task = await this.db.repos.task.fetch(taskID) as Task
        await this.db.remove('user', task.from, 'tracking', taskID)
        await this.db.remove('user', task.to, 'tasks', taskID)
        await this.db.repos.task.remove(taskID)
    }

    async finishTask(taskID: TaskID): Promise<Awaited<ReturnType<NonNullable<ValueOf<ChatRegisterEvent>['finish'] | undefined>>>> {
        let task = await this.db.repos.task.fetch(taskID) as Task
        // 根據 task 的 event 執行指定任務
        const eventResult = this.events[task.eventType]?.finish?.call(this.db, task)
        // 刪除 user from 的跟蹤
        let fromUser = await this.db.repos.user.fetch(task.from) as User
        const trackingIndex = fromUser.tracking.indexOf(taskID)
        if (trackingIndex >= 0) {
            fromUser.tracking.splice(trackingIndex, 1)
            await this.db.repos.user.save(fromUser)
        }
        // 刪除 user to 的任務
        let toUsers = await this.db.repos.user.fetch(task.to) as User
        const taskIndex = toUsers.tasks.indexOf(taskID)
        if (taskIndex >= 0) {
            toUsers.tasks.splice(taskIndex, 1)
            await this.db.repos.user.save(toUsers)
        }
        // 刪除任務
        await this.db.repos.task.remove(taskID)
        return eventResult
    }

    async FriendInvitation(from: UserID, to: UserID): Promise<any[]> {
        return await this.task({
            from, 
            to, 
            eventType: ChatEvents.FriendInvitation
        })
    }
    
    async FriendConfirmation(taskID: TaskID, /* from: UserID, to: UserID */): Promise<any[]> {
        return await this.finishTask(taskID)
    }

    async createDirectGroup(user1: UserID, user2: UserID): Promise<GroupID> {
        let group = await this.db.repos.group.save({
            creator  : 'system',
            createAt : new Date(),
            members  : [user1, user2],
            messages : [],
            isDirect : true
        }) as Group

        const groupID = group[EntityId] as GroupID
        return groupID
    }

    async groupInvitation(inviter: UserID, groupID: GroupID, invitedMembers: UserID | UserID[]) {
        if (!invitedMembers.length) return
        return await this.task({
            creator   : inviter,
            from      : groupID,
            to        : invitedMembers, 
            eventType : ChatEvents.GroupInvitation,
        })
    }

    async groupConfirmation(taskID: TaskID, /* userID: UserID, groupID: GroupID */) {
        return await this.finishTask(taskID)
    }
    async createGroup(name: string, creator: UserID, avatar: string, invitedMembers: UserID[] = []): Promise<GroupID> {
        
        let group = await this.db.repos.group.save({
            name,
            creator,
            createAt : new Date(),
            avatar,
            members  : [creator],
            messages : [],
            isDirect : false
        }) as Group

        const groupID = group[EntityId] as GroupID
        
        // 儲存到 creator 自己的資料中
        await this.db.push('user', creator, 'groups', groupID)

        await this.groupInvitation(creator, groupID, invitedMembers)

        return groupID
    }

    async sendMessage(from: UserID, to: GroupID, content: string): Promise<MessageID> {

        let message = await this.db.repos.message.save({
            from,
            to,
            content,
            createAt: new Date(),
            readers: [from]
        }) as Message

        const messageID = message[EntityId] as MessageID

        // FIXME: 兩個方法
        const method = 1
        if (method === 1) {
            // 1: 直接寫到 group 的 messages 中
            await this.db.push('group', to, 'messages', messageID)
            // 發送通知
            await this.notify(from, to, content, ChatEvents.SendMessage)

        } else if (method === 2) {
            // 2: 寫成 task，等第一個用戶在線再寫到 group 的 messages 中
            await this.task({
                from,
                to,
                creator   : from,
                eventType : ChatEvents.SendMessage,
                content
            })
            // 發送通知
            await this.notify(from, to, content, ChatEvents.SendMessage)
        }
        return messageID
    }

    async readMsg(reader: UserID, messageID: MessageID) {
        return await this.db.push('message', messageID, 'readers', reader)
    }

    // TODO - 讀取離線消息
    async checkForOfflineMessages(userID: UserID) {
        let user = await this.db.repos.user.fetch(userID) as User
        return user.notifications
    }

}

export {
    Controller
}

// 生成單例
// export const ContollerInstance = Singleton(Controller)









