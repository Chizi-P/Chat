import { createClient, RedisClientType, RedisClientOptions } from 'redis'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { EntityId } from 'redis-om'
import { createRepositories, RepositoriesType } from './schema.js'
import type { RepositoriesDataType } from './schema.js'

// 單例
function Singleton<T>(Class: new (...args: any[]) => T): (...args: any[]) => T {
    let instance: T | undefined
    return (...args: any[]): T => instance || (instance = new Class(...args))
}

type UserID         = string
type GroupID        = string
type MessageID      = string
type NotificationID = string
type TaskID         = string
type User           = RepositoriesDataType['user']
type Group          = RepositoriesDataType['group']
type Message        = RepositoriesDataType['message']
type Notification   = RepositoriesDataType['notification'] & { eventType: ChatEvents }
type Task           = RepositoriesDataType['task'] & { eventType: ChatEvents }
type ValueOf<T>     = T[keyof T]
type DataWithSet<T> = T & {
    set: (key: keyof T, value: T[keyof T]) => Promise<T>
}

enum ChatEvents {
    SendMessage            = 'sendMessage',         // 發送訊息
    FriendInvitation       = 'friendInvitation',    // 好友邀請
    // FriendConfirmation     = 'friendConfirmation',  // 確認好友關係
    GroupInvitation        = 'groupInvitation',     // 群組邀請
    // GroupConfirmation      = 'groupConfirmation',   // 確認加入群組
}

type ChatRegisterEvent = Record<ChatEvents | string, {
    action? : (this: ChatBase, task: Task) => Promise<any>,
    finish? : (this: ChatBase, task: Task) => Promise<any>,
}>

enum ChatError {
    EmailAlreadyExists     = 'EmailAlreadyExists',     // 電子郵件已存在
    InvalidEmail           = 'InvalidEmail',           // 無效的電子郵件
    InvalidUsername        = 'InvalidUsername',        // 無效的用戶名
    WeakPassword           = 'WeakPassword',           // 弱密碼
    InvalidPassword        = 'InvalidPassword',        // 無效的密碼
    ServerError            = 'ServerError',            // 伺服器內部錯誤
    CaptchaError           = 'CaptchaError',           // 驗證碼錯誤
    TermsNotAccepted       = 'TermsNotAccepted',       // 用戶未接受條款
    UserNotFound           = 'UserNotFound',           // 用戶不存在
    AccountOrPasswordError = 'AccountOrPasswordError', // 帳號或密碼錯誤
    TokenValidationError   = 'TokenValidationError',   // token 驗證失敗
}

type ResultWithChatError<T extends object = {}> =
    | ({ err?: undefined } & T)
    | ({ err: ChatError | string } & Partial<T>)

type Options = {
    privateKey: jwt.Secret
}

class ChatBase {

    private db             : RedisClientType
    private redisOptions?  : RedisClientOptions // FIXME: use options
    public  repos          : RepositoriesType
    private options        : Options
    public  isSavingLog    : boolean = true
    public  isShowingLog   : boolean = true
    public  isLogWithTable : boolean = true

    constructor(options: Options, redisOptions?: RedisClientOptions) {
        this.redisOptions = redisOptions
        this.options = options
        this.db = createClient()
        this.db.on('error',  err => this.logger('Redis Client Error', err))
        this.db.on('connect', () => this.logger('Redis client connected'))
        this.db.on('end',     () => this.logger('Redis client disconnected'))

        this.repos = createRepositories(this.db)
        this.connect().then(() => {
            Object.entries(this.repos).forEach(([key, val]) => {
                val.createIndex().then(() => this.logger(`Index of ${key} created successfully`))
            })
        })
    }

    private async push(
        repoKey: keyof RepositoriesType, 
        id: string, 
        key: keyof RepositoriesDataType[typeof repoKey], 
        ...pushData: any[]
    ) {
        let obj = await this.repos[repoKey].fetch(id) as RepositoriesDataType[typeof repoKey]
        (obj[key] as typeof pushData).push(...pushData)
        return await this.repos[repoKey].save(obj)
    }

    private async remove(
        repoKey: keyof RepositoriesType, 
        id: string, 
        key: keyof RepositoriesDataType[typeof repoKey], 
        ...removeData: any[]
    ) {
        let obj = await this.repos[repoKey].fetch(id) as RepositoriesDataType[typeof repoKey]
        (obj[key] as typeof removeData) = (obj[key] as typeof removeData).filter(e => !(e in removeData))
        return await this.repos[repoKey].save(obj) as RepositoriesDataType[typeof repoKey]
    }
    
    private events : ChatRegisterEvent = {
        [ChatEvents.FriendInvitation]: {
            action: async task => {
                this.logger('FriendInvitation task action')
                this.logger(task)
                const { from, to, content, eventType } = task
                // 發送通知
                await this.notify(from, to, content, eventType)
                return task
            },
            finish: async task => {
                this.logger('FriendInvitation task finish')
                const { from, to, content, eventType } = task
                const groupID = await this.createDirectGroup(from, to)
                await this.push('user', from, 'friends', groupID)
                await this.push('user', to, 'friends', groupID)
                // 發送通知
                await this.notify(from, to, content, eventType)
                return groupID
            }
        },
        [ChatEvents.GroupInvitation]: {
            action: async task => {
                this.logger('GroupInvitation action')
                this.logger(task)
                const { from, to, content, eventType } = task
                // 發送通知
                await this.notify(from, to, content, eventType)
                return task
            },
            finish: async task => {
                const { from, to, content, eventType } = task
                await this.push('user', to, 'groups', from)
                await this.push('group', from, 'members', to)
                // 發送通知
                await this.notify(from, to, content, eventType)
            }
        }
    }

    registerEvent(name: keyof ChatRegisterEvent, eventData: ValueOf<ChatRegisterEvent>) {
        this.events[name] = eventData
    }

    public async logger(...log: (string | object)[]): Promise<void> {
        if (this.isShowingLog) {
            if (typeof log === 'object' && this.isLogWithTable) console.table(...log)
            else                                                console.log(...log)
        }
        if (this.isSavingLog) {
            await this.db.lPush('logs', JSON.stringify({ log: log.join(' '), createAt: Date.now() }))
        }
    }

    private async hash(data: string | Buffer): Promise<string> {
        const saltRounds = 10
        const salt = await bcrypt.genSalt(saltRounds)
        return await bcrypt.hash(data, salt)
    }

    async connect() {
        await this.db.connect()
        return this
    }

    async disconnect() {
        await this.db.disconnect()
        return this
    }

    async createUser(
        name: string, 
        email: string, 
        password: string, 
        otherData?: Record<string, any>
    ): Promise<UserID | ChatError> {
        // 檢查 email 是否已經存在
        if (await this.repos.user.search().where('email').eq(email).return.count() > 0) return ChatError.EmailAlreadyExists
        let user = await this.repos.user.save({
            name, 
            email, 
            hashedPassword : await this.hash(password),
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

    async setFactory<T extends ValueOf<RepositoriesDataType>>(obj: T) {
        return async (key: keyof T, value: T[keyof T]): Promise<T> => {
            obj[key] = value
            return await this.repos.user.save(obj) as T
        }
    }

    // FIXME - get user data
    // OPT 使用方法和類型
    // async getUser(userID: UserID): Promise<DataWithSet<User>> {
    //     let user = await this.repos.user.fetch(userID) as User
    //     return user
    // }
    // async user(userID: UserID): Promise<DataWithSet<User>> {
    //     let user = await this.repos.user.fetch(userID) as User
        
    //     return {...user, set: await this.setFactory(user)} as DataWithSet<User>
    // }
    // async group(groupID: GroupID): Promise<Group> {
    //     let group = await this.repos.user.fetch(groupID) as Group
    //     return {...group, set: await this.setFactory(group)} as DataWithSet<Group>
    // }
    // TODO: other
    // ...

    async login(token: string, password?: string): Promise<ResultWithChatError<{token: string, userID: UserID, name: string, email: string}>>
    async login(email: string, password: string): Promise<ResultWithChatError<{token: string, userID: UserID, name: string, email: string}>>
    async login(tokenOrEmail: string, password: string): Promise<ResultWithChatError<{token: string, userID: UserID, name: string, email: string}>> {
        // login with token
        if (password === undefined) {
            try {
                let user = jwt.verify(tokenOrEmail, this.options.privateKey) as jwt.UserJwtPayload
                return { token: tokenOrEmail, userID: user.userID, name: user.name, email: user.email }
            } catch(e) {
                console.log(e)
                return { err: ChatError.TokenValidationError }
            }
        }

        // login with email and password
        // 搜尋對應 email 的 user
        let user = await this.repos.user.search().where('email').eq(tokenOrEmail).return.first() as User
        // 檢測 user 是否存在 和 密碼是否正確
        if (user === null || !await bcrypt.compare(password, user.hashedPassword)) return { err: ChatError.AccountOrPasswordError }

        const userID = user[EntityId] as UserID

        const token = jwt.sign({
            userID   : userID, 
            name     : user.name, 
            email    : user.email, 
            createAt : Date.now(),
        }, this.options.privateKey)

        return { token, userID, name: user.name, email: user.email }
    }

    // 通知
    async notify(from: UserID, to: UserID, content: string, eventType: ChatEvents): Promise<NotificationID> {
        let notification = await this.repos.notification.save({
            from, 
            to,
            eventType,
            content,
            createAt: new Date()
        }) as Notification

        const notificationID = notification[EntityId] as NotificationID
        await this.push('user', from, 'notifications', notificationID)

        return notificationID
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

            const isExisted = await this.repos.task.search()
                .where('from').eq(from)
                .and('to').eq(toUser)
                .and('eventType').eq(eventType).return.count() > 0
                // .and('content').eq(content).returnCount() > 0;
            if (isExisted) {
                console.log('task is existed')
                return
            }

            let task = await this.repos.task.save({
                from,
                to : toUser,
                eventType,
                creator,
                createAt: new Date(),
                content,
            }) as Task

            const taskID = task[EntityId] as TaskID
            await this.push('user', toUser, 'tasks', taskID)
            // 執行 event 對應任務
            const eventResult = await this.events[eventType]?.action?.call(this, task)
            eventResults.push(eventResult)
            taskIDs.push(taskID)
        })
        await this.push('user', from, 'tracking', ...taskIDs)

        return eventResults
    }
    async cancelTask(taskID: TaskID) {
        let task = await this.repos.task.fetch(taskID) as Task
        await this.remove('user', task.from, 'tracking', taskID)
        await this.remove('user', task.to, 'tasks', taskID)
        await this.repos.task.remove(taskID)
    }
    async finishTask(taskID: TaskID): Promise<Awaited<ReturnType<NonNullable<ValueOf<ChatRegisterEvent>['finish'] | undefined>>>> {
        let task = await this.repos.task.fetch(taskID) as Task
        // 根據 task 的 event 執行指定任務
        const eventResult = this.events[task.eventType]?.finish?.call(this, task)
        // 刪除 user from 的跟蹤
        let fromUser = await this.repos.user.fetch(task.from) as User
        const trackingIndex = fromUser.tracking.indexOf(taskID)
        if (trackingIndex >= 0) {
            fromUser.tracking.splice(trackingIndex, 1)
            await this.repos.user.save(fromUser)
        }
        // 刪除 user to 的任務
        let toUsers = await this.repos.user.fetch(task.to) as User
        const taskIndex = toUsers.tasks.indexOf(taskID)
        if (taskIndex >= 0) {
            toUsers.tasks.splice(taskIndex, 1)
            await this.repos.user.save(toUsers)
        }
        // 刪除任務
        await this.repos.task.remove(taskID)
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
        let group = await this.repos.group.save({
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
        
        let group = await this.repos.group.save({
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
        await this.push('user', creator, 'groups', groupID)

        await this.groupInvitation(creator, groupID, invitedMembers)

        return groupID
    }
    async sendMessage(from: UserID, to: GroupID, content: string): Promise<MessageID> {

        let message = await this.repos.message.save({
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
            await this.push('group', to, 'messages', messageID)
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
        return await this.push('message', messageID, 'readers', reader)
    }
    // TODO - 讀取離線消息
    async checkForOfflineMessages(userID: UserID) {
        let user = await this.repos.user.fetch(userID) as User
        return user.notifications
    }

    async quit() {
        return await this.db.quit()
    }
}

// 生成單例
const Chat = Singleton(ChatBase)

export type {
    ChatRegisterEvent,
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
}

export {
    Chat,
    ChatError,
    ChatEvents,
}