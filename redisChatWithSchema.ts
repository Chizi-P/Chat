import { createClient, RedisClientType, RedisClientOptions } from 'redis'
import bcrypt from 'bcrypt'
// import { v5 as uuidv5 } from 'uuid'
import { Repository, Entity, EntityData, EntityId, EntityKeyName } from 'redis-om'
import { createRepositories, RepositoriesType, RepositoriesDataType } from './schema'

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
type Notification   = RepositoriesDataType['notification']
type Task           = RepositoriesDataType['task']

enum ChatEvents {
    SendMessage            = 'sendMessage',         // 發送訊息
    FriendInvitation       = 'friendInvitation',    // 好友邀請
    // FriendConfirmation     = 'friendConfirmation',  // 確認好友關係
    GroupInvitation        = 'groupInvitation',     // 群組邀請
    // GroupConfirmation      = 'groupConfirmation',   // 確認加入群組
}

type ChatRegisterEvent = Record<string, {
    action? : (this: ChatBase, task: Task) => Promise<any>,
    finish? : (this: ChatBase, task: Task) => Promise<any>,
}>

enum ChatError {
    EmailAlreadyExists = 'EmailAlreadyExists', // 電子郵件已存在
    InvalidEmail       = 'InvalidEmail',       // 無效的電子郵件
    InvalidUsername    = 'InvalidUsername',    // 無效的用戶名
    WeakPassword       = 'WeakPassword',       // 弱密碼
    InvalidPassword    = 'InvalidPassword',    // 無效的密碼
    ServerError        = 'ServerError',        // 伺服器內部錯誤
    CaptchaError       = 'CaptchaError',       // 驗證碼錯誤
    TermsNotAccepted   = 'TermsNotAccepted',   // 用戶未接受條款
    UserNotFound       = 'UserNotFound'        // 用戶不存在
}

// TODO: 通知
class ChatBase {
    
    private db        : RedisClientType
    private options?  : RedisClientOptions
    private repos     : RepositoriesType
    public  isSaveLog : boolean = true
    constructor(options? : RedisClientOptions) {
        this.options = options
        this.db = createClient()
        this.db.on('error',  err => console.log('Redis Client Error', err))
        this.db.on('connect', () => console.log('Redis client connected'))
        this.db.on('end',     () => console.log('Redis client disconnected'))

        this.repos = createRepositories(this.db)
    }
    private async pushed(repoKey: keyof RepositoriesType, id: string, key: keyof RepositoriesDataType[typeof repoKey], ...pushData: any[]) {
        let obj = await this.repos[repoKey].fetch(id) as RepositoriesDataType[typeof repoKey]
        (obj[key] as typeof pushData[]).push(...pushData)
        return await this.repos[repoKey].save(obj)
    }
    
    private events : ChatRegisterEvent = {
        [ChatEvents.FriendInvitation]: {
            action: async task => {
                console.log('FriendInvitation action')
                console.table(task)
                return task
            },
            finish: async task => {
                const from = task.from
                const to   = task.to

                const groupID = await this.createDirectGroup(from, to)
                await this.pushed('user', from, 'friends', groupID)
                await this.pushed('user', to, 'friends', groupID)

                console.log('FriendInvitation finish')
                return groupID
            }
        },
        [ChatEvents.GroupInvitation]: {
            action: async task => {
                console.log('GroupInvitation action')
                console.table(task)
                return task
            },
            finish: async task => {
                const groupID = task.from
                const userID = task.to

                await this.pushed('user', userID, 'groups', groupID)
                await this.pushed('group', groupID, 'members', userID)
            }
        }
    }
    registerEvent(name: keyof ChatRegisterEvent | ChatEvents, eventData: ChatRegisterEvent[keyof ChatRegisterEvent]) {
        this.events[name] = eventData
    }
    private async logger(log: string): Promise<number | undefined> {
        if (!this.isSaveLog) return
        return await this.db.lPush('logs', JSON.stringify({
            log,
            createAt: Date.now()
        }))
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
    async createUser(name: string, email: string, password: string, otherData?: Record<string, any>): Promise<UserID | ChatError> {

        if (await this.repos.user.search().where('email').eq(email).count() > 0) ChatError.EmailAlreadyExists

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

    // 通知
    async notify(notificationData: { from: UserID, to: UserID, content: string, eventType: string }): Promise<NotificationID> {
        const { from, to, eventType, content } = notificationData

        let notification = await this.repos.notification.save({
            from, 
            to,
            eventType,
            content,
            createAt: new Date()
        }) as Notification

        const notificationID = notification[EntityId] as NotificationID
        await this.pushed('user', from, 'notifications', notificationID)

        return notificationID
    }

    async task(taskData: { from: UserID, to: UserID, eventType: ChatEvents, creator?: UserID, content?: string }): Promise<Awaited<ReturnType<NonNullable<ChatRegisterEvent[keyof ChatRegisterEvent]['action']>>>[]>
    async task(taskData: { from: UserID, to: UserID[], eventType: ChatEvents, creator?: UserID, content?: string }): Promise<Awaited<ReturnType<NonNullable<ChatRegisterEvent[keyof ChatRegisterEvent]['action']>>>[]>
    async task(taskData: { from: UserID, to: UserID | UserID[], eventType: ChatEvents, creator?: UserID, content?: string }): Promise<Awaited<ReturnType<NonNullable<ChatRegisterEvent[keyof ChatRegisterEvent]['action']>>>[]> {
        const { from, eventType, content } = taskData
        let { to, creator } = taskData
        to = Array.isArray(to) ? to: [to]
        creator = creator ?? from
        let taskIDs: TaskID[] = []
        let eventResults: Awaited<ReturnType<NonNullable<ChatRegisterEvent[keyof ChatRegisterEvent]['action']>>>[] = []
        to.forEach(async e => {
            let task = await this.repos.task.save({
                from,
                to,
                eventType,
                creator,
                createAt: new Date(),
                content: content ?? '',
            }) as Task

            const taskID = task[EntityId] as TaskID
            // 執行 event 對應任務
            const eventResult = await this.events[task.eventType]?.action?.call(this, task)
            eventResults.push(eventResult)
            taskIDs.push(taskID)

            await this.pushed('user', e, 'tasks', taskID)
        })
        await this.pushed('user', from, 'tracking', ...taskIDs)

        return eventResults
    }
    async finishTask(taskID: TaskID): Promise<Awaited<ReturnType<NonNullable<ChatRegisterEvent[keyof ChatRegisterEvent]['finish'] | undefined>>>> {
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

    async FriendInvitation(from: UserID, to: UserID) {

        const taskResult = await this.task({
            from, 
            to, 
            eventType: ChatEvents.FriendInvitation
        })

        // TODO: 通知
        // await this.notify({ from, to, event: ChatEvents.FriendInvitation, msg: `來自 ${from} 的好友邀請` })

        return taskResult
    }
    
    // TODO: 可以刪掉
    async FriendConfirmation(taskID: TaskID, /* from: UserID, to: UserID */) {
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

    async groupInvitation(inviter: UserID, groupID: GroupID, invitedMembers: UserID[]) {
        if (!invitedMembers.length) return

        return await this.task({
            creator   : inviter,
            from      : groupID,
            to        : invitedMembers, 
            eventType : ChatEvents.GroupInvitation,
        })
        // TODO: 通知
        // await this.notify({ from: groupID, to: invitedMembers, event, msg: `${from} 邀請您加入[${groupID}]群組` })
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
        await this.pushed('user', creator, 'groups', groupID)

        await this.groupInvitation(creator, groupID, invitedMembers)

        return groupID
    }
    async sendMessage(from: UserID, to: GroupID, content: string): Promise<MessageID> {

        let message = await this.repos.message.save({
            from,
            to,
            content,
            createAt: new Date(),
            reader: [from]
        }) as Message

        const messageID = message[EntityId] as MessageID

        // FIXME: 兩個方法
        const method = 1
        if (method === 1) {
            // 1: 直接寫到 group 的 messages 中
            await this.pushed('group', to, 'messages', messageID)

            // TODO: 通知

        } else if (method === 2) {
            // 2: 寫成 task，等第一個用戶在線再寫到 group 的 messages 中
            await this.task({
                from,
                to,
                creator   : from,
                eventType : ChatEvents.SendMessage,
                content
            })

            // TODO: 通知

        }
        return messageID
    }
    async readMsg(reader: UserID, messageID: MessageID) {
        return await this.pushed('message', messageID, 'readers', reader)
    }
    async quit() {
        return await this.db.quit()
    }
}

// 生成單例
const Chat = Singleton(ChatBase)

export default Chat