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
    File,
    ChatRegisterEvent,
    ResultWithChatError,
} from "./DatabaseType.js"
import { ChatEvents, ChatError, MessageType } from "./DatabaseType.js"
import { RepositoriesDataType, RepositoriesType } from './schema.js'


class Controller {

    public db     : RedisDatabase
    public config : Config

    public publicData : { [key: string]: string[] } = {
        user    : ['id', 'name', 'avatar', 'isOnline'],
        group   : ['id', 'name', 'creator', 'avatar', 'createAt'],
        message : [],
        task    : [],
    }
    

    constructor(){
        // FIXME - privateKey
        this.config = { privateKey: 'chat' }
        this.db = RedisDB(this.config)
    }
    
    public async log(...message: Parameters<RedisDatabase['log']>): ReturnType<RedisDatabase['log']> {
        await this.db.log(...message)
    }
    
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
                await this.db.push('user', from, 'friends', to)
                await this.db.push('user', to, 'friends', from)
                const groupID = await this.createDirectGroup(from, to)
                await this.db.push('user', from, 'directGroups', groupID)
                await this.db.push('user', to, 'directGroups', groupID)
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

    public registerEvent(name: keyof ChatRegisterEvent, eventData: ValueOf<ChatRegisterEvent>) {
        this.events[name] = eventData
    }

    public async userExisted(userID: UserID) {
        return await this.db.db.exists(`user:${userID}`)
    }

    public async groupExisted(groupID: GroupID) {
        return await this.db.db.exists(`group:${groupID}`)
    }

    public async messageExisted(messageID: MessageID) {
        return await this.db.db.exists(`message:${messageID}`)
    }

    public async taskExisted(taskId: TaskID) {
        return await this.db.db.exists(`task:${taskId}`) 
    }

    public omit<T extends ValueOf<RepositoriesDataType>>(obj: T, omitKeys: string | string[]): Partial<T> {
        if (!Array.isArray(omitKeys)) omitKeys = [omitKeys]
        return Object.fromEntries(
            Object.entries(obj).filter(([key]) => !omitKeys.includes(key))
        ) as Partial<T>
    }

    public async getData<T extends keyof RepositoriesType>(repo: T, id: string) {
        return await this.db.repos[repo].fetch(id) as RepositoriesDataType[T]
    }

    public async setData<T extends keyof RepositoriesType>(repo: T, id: string, data: Partial<RepositoriesDataType[T]>) {
        let obj = await this.db.repos[repo].fetch(id)
        Object.entries(data).forEach(([key, val])=> {
            obj[key] = val
        })
        return await this.db.repos[repo].save(obj) as RepositoriesDataType[T]
    } 

    // public async getUser(userID: UserID): Promise<User> {
    //     return await this.db.repos.user.fetch(userID) as User
    // }
    public async setUser(userID: UserID, data: Partial<User>): Promise<User> {
        let user = await this.db.repos.user.fetch(userID) as User
        Object.entries(data).forEach(([key, val])=> {
            user[key] = val
        })
        return await this.db.repos.user.save(user) as User
    }

    public async emailExisted(email: string) {
        return await this.db.existed('user', 'email', email)
    }

    public async getPublicData<T extends keyof RepositoriesType>(repo: T, id: string) {
        return await this.db.filter(repo, id, ([key, val]) => this.publicData[repo].includes(key))
    }

    public async pickData<T extends keyof RepositoriesType>(repo: T, id: string, pick: string[]) {
        return await this.db.filter(repo, id, ([key, val]) => pick.includes(key))
    }

    public async getGroupPublicData(groupID: GroupID) {
        let group = await this.db.repos.group.fetch(groupID) as Group
        const groupPublicDataKey = ['name', 'avatar', 'isOnline'] as const
        type GroupPublicData = Pick<User, keyof ValueOf<typeof groupPublicDataKey>>
        const groupPublicData: GroupPublicData = Object.entries(group).filter(([key, val]) => key in groupPublicDataKey)
        return groupPublicData
    }
    
    public async createUser(
        name       : string, 
        email      : string, 
        password   : string, 
        otherData? : Record<string, any>
    ): Promise<User | ChatError> {

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
        user.id = user[EntityId] as string
        user = await this.db.repos.user.save(user) as User

        return user
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

        notification.id = notification[EntityId] as string
        notification = await this.db.repos.notification.save(notification) as Notification

        const notificationID = notification[EntityId] as NotificationID
        await this.db.push('user', from, 'notifications', notificationID)

        return notificationID
    }

    async loginWithToken(token: string) {
        try {
            let user = jwt.verify(token, this.config.privateKey) as jwt.UserJwtPayload
            return { 
                token  : token, 
                userID : user.userID, 
                name   : user.name,
                email  : user.email
            }
        } catch(e) {
            this.log(e as object)
            return { err: ChatError.TokenValidationError }
        }
    }

    async loginWithEmail(email: string, password: string) {
        // 搜尋對應 email 的 user
        let user = await this.db.repos.user.search().where('email').eq(email).return.first() as User
        // user 是否存在 和 密碼是否正確
        if (user === null || !await bcrypt.compare(password, user.hashedPassword)) return { err: ChatError.AccountOrPasswordError }
        const userID = user[EntityId] as UserID

        const token = jwt.sign({
            userID   : userID, 
            name     : user.name, 
            email    : user.email, 
            createAt : Date.now(),
        }, this.config.privateKey)

        return { 
            token, 
            userID, 
            name  : user.name, 
            email : user.email 
        }
    }

    // TODO - delete
    async login(data: { token?: string, email?: string, password?: string }): Promise<ResultWithChatError<{token: string, userID: UserID, name: string, email: string}>> {
        const { token, email, password } = data
        // login with token
        if (token) {
            try {
                let user = jwt.verify(token, this.config.privateKey) as jwt.UserJwtPayload
                return { 
                    token  : token, 
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
        if (email && password) {
            // 搜尋對應 email 的 user
            let user = await this.db.repos.user.search().where('email').eq(email).return.first() as User
            // user 是否存在 和 密碼是否正確
            if (user === null || !await bcrypt.compare(password, user.hashedPassword)) return { err: ChatError.AccountOrPasswordError }
            const userID = user[EntityId] as UserID

            const token = jwt.sign({
                userID   : userID, 
                name     : user.name, 
                email    : user.email, 
                createAt : Date.now(),
            }, this.config.privateKey)

            return { 
                token, 
                userID, 
                name  : user.name, 
                email : user.email 
            }
        }

        return { err: ChatError.AccountOrPasswordError }
    }

    async createTask(
        taskData: { 
            from      : UserID, 
            to        : UserID | UserID[], 
            eventType : ChatEvents, 
            creator?  : UserID, 
            content?  : string 
        }): Promise<Awaited<ReturnType<NonNullable<ValueOf<ChatRegisterEvent>['action']>>>[]> {
        
        const { from, eventType } = taskData
        const to = Array.isArray(taskData.to) ? taskData.to: [taskData.to]
        const creator = taskData.creator ?? from
        const content = taskData.content ?? ''

        let taskIDs: TaskID[] = []
        let eventResults: Awaited<ReturnType<NonNullable<ValueOf<ChatRegisterEvent>['action']>>>[] = []
        let tasks: Task[] = []

        to.forEach(async toUser => {

            const isExisted = await this.db.repos.task.search()
                .where('from').eq(from)
                .and('to').eq(toUser)
                .and('eventType').eq(eventType).return.count() > 0
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
            task.id = task[EntityId] as string
            task = await this.db.repos.task.save(task) as Task

            const taskID = task[EntityId] as TaskID
            await this.db.push('user', toUser, 'tasks', taskID)
            // 執行 event 對應任務
            const eventResult = await this.events[eventType]?.action?.call(this.db, task)
            eventResults.push(eventResult)
            taskIDs.push(taskID)

            tasks.push(task)
        })
        await this.db.push('user', from, 'tracking', ...taskIDs)

        return tasks
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
        return await this.createTask({
            from, 
            to, 
            eventType: ChatEvents.FriendInvitation
        })
    }

    async createDirectGroup(user1: UserID, user2: UserID): Promise<GroupID> {
        let group = await this.db.repos.group.save({
            creator  : 'system',
            createAt : new Date(),
            members  : [user1, user2],
            messages : [],
            isDirect : true
        }) as Group
        group.id = group[EntityId] as string
        group = await this.db.repos.group.save(group) as Group

        const groupID = group[EntityId] as GroupID
        return groupID
    }

    async groupInvitation(inviter: UserID, groupID: GroupID, invitedMembers: UserID | UserID[]) {
        if (!invitedMembers.length) return
        return await this.createTask({
            creator   : inviter,
            from      : groupID,
            to        : invitedMembers, 
            eventType : ChatEvents.GroupInvitation,
        })
    }

    async createGroup(name: string, creator: UserID, avatar: string, invitedMembers: UserID[] = []): Promise<Group> {
        
        let group = await this.db.repos.group.save({
            name,
            creator,
            createAt : new Date(),
            avatar,
            members  : [creator],
            messages : [],
            isDirect : false
        }) as Group
        group.id = group[EntityId] as string
        group = await this.db.repos.group.save(group) as Group

        const groupID = group[EntityId] as GroupID
        
        // 儲存到 creator 自己的資料中
        await this.db.push('user', creator, 'groups', groupID)

        await this.groupInvitation(creator, groupID, invitedMembers)

        return group
    }

    async isMember(userID: UserID, groupID: GroupID) {
        const group = await this.db.repos.group.fetch(groupID) as Group
        return group.members.includes(userID)
    }

    async createMessage(from: UserID, to: GroupID, type: MessageType, content: string): Promise<Message> {
        let message = await this.db.repos.message.save({
            from,
            to,
            type,
            content,
            createAt: new Date(),
            readers: [from]
        } as Message) as Message
        message.id = message[EntityId] as string
        message = await this.db.repos.message.save(message) as Message

        const messageID = message[EntityId] as MessageID

        // 直接寫到 group 的 messages 中
        await this.db.push('group', to, 'messages', messageID)
        // 發送通知
        await this.notify(from, to, content, ChatEvents.SendMessage)
        return message
    }

    async readMsg(reader: UserID, messageID: MessageID) {
        return await this.db.push('message', messageID, 'readers', reader)
    }

    // TODO - 讀取離線消息
    async checkForOfflineMessages(userID: UserID) {
        let user = await this.db.repos.user.fetch(userID) as User
        return user.notifications
    }

    async createFile(creator: UserID, type: string) {
        let file = await this.db.repos.file.save({
            type: type,
            url: '',
            creator: creator,
            createAt: new Date(),
        } as File)

        const fileID = file[EntityId]
        return fileID
    }
}

export {
    Controller
}

// 生成單例
// export const ContollerInstance = Singleton(Controller)