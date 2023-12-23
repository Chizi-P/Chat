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
    FriendConfirmation     = 'friendConfirmation',  // 確認好友關係
    GroupInvitation        = 'groupInvitation',     // 群組邀請
    GroupConfirmation      = 'groupConfirmation',   // 確認加入群組
}

// enum ChatMemberType {
//     users  = 'users',
//     groups = 'groups',
// }


// TODO: 修改方法的回傳
class ChatBase {
    
    private db: RedisClientType
    private options?: RedisClientOptions
    isSaveLog: boolean = true

    private repositories: RepositoriesType

    constructor(options? : RedisClientOptions) {
        this.options = options
        this.db = createClient()
        this.db.on('error',  err => console.log('Redis Client Error', err))
        this.db.on('connect', () => console.log('Redis client connected'))
        this.db.on('end',     () => console.log('Redis client disconnected'))

        this.repositories = createRepositories(this.db)
    }
    // users = {
    //     uuid    : { namespace: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' },
    //     prefix  : 'users',
    //     default : {
    //         avatar: '/',
    //     },
    // }
    // groups = {
    //     uuid    : { namespace: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' },
    //     prefix  : 'groups',
    //     default : {
    //         name      : (creator: string) => `${creator} 創建的群組:${Date.now()}`,
    //         avatar    : '/',
    //         hierarchy : ['invited', 'member', 'administrator', 'creator'],
    //     },
    // }
    // system = {
    //     id: 'system'
    // }

    private logger(log: string): void {
        if (!this.isSaveLog) return
        this.db.lPush('logs', JSON.stringify({
            log,
            createAt: Date.now()
        }))
    }
    private async hash(data: string | Buffer): Promise<string> {
        const saltRounds = 10
        const salt = await bcrypt.genSalt(saltRounds)
        return await bcrypt.hash(data, salt)
    }
    private returnMsg(ok: boolean, msg: string): { ok: boolean, msg: string } {
        console.table({ ok, msg })
        return { ok, msg }
    }
    async connect() {
        await this.db.connect()
        return this
    }
    async disconnect() {
        await this.db.disconnect()
        return this
    }
    async createUser(name: string, email: string, password: string, otherData?: Record<string, any>) {
        // const { name, email, password, avatar } = userData

        if (await this.repositories.user.search().where('email').eq(email as string).count() > 0) return this.returnMsg(false, '用戶已存在')

        let user = await this.repositories.user.save({
            name, 
            email, 
            hashedPassword: await this.hash(password),
            createAt      : new Date(),
            friends       : [],
            groups        : [],
            notifications : [],
            tasks         : [],
            // tracking   : [], // TODO: 試試看 tracking 沒有輸入會有什麼結果
            ...otherData ?? {},
        }) as User

        // FIXME: return userID
        const userID = user[EntityId]!

        return this.returnMsg(true, '註冊成功')
    }

    // 通知
    async notify(notificationData: { from: UserID, to: UserID[], content: string, event: string }) {
        const { from, to, event, content } = notificationData
        // let to = notification.to
        // to = Array.isArray(to) ? to : [to]
        // const multi = this.db.multi()
        // to.forEach(async member => {
        //     multi.lPush(this.user(member).notification, JSON.stringify({ from, event, msg }))
        // })
        // const replies = await multi.exec()
        // if (replies.some(e => e as number <= 0)) return this.returnMsg(false, '資料庫出現問題')

        let notification = await this.repositories.notification.save({
            from, 
            to,
            event,
            content,
            createAt: new Date()
        }) as Notification

        const notificationID = notification[EntityId] as NotificationID

        let user = await this.repositories.user.fetch(from) as User


        user.notifications.push(notificationID)
        user = await this.repositories.user.save(user) as User

        return this.returnMsg(true, '已發送通知')
    }

    async task(taskData: { from: UserID, to: UserID, event: ChatEvents, creator?: UserID, content?: string }): Promise<ReturnType<typeof this.returnMsg>>
    async task(taskData: { from: UserID, to: UserID[], event: ChatEvents, creator?: UserID, content?: string }): Promise<ReturnType<typeof this.returnMsg>>
    async task(taskData: { from: UserID, to: UserID | UserID[], event: ChatEvents, creator?: UserID, content?: string }): Promise<ReturnType<typeof this.returnMsg>> {
        const { from, event, content } = taskData
        let { to, creator } = taskData
        to = Array.isArray(to) ? to: [to]
        creator = creator ?? from

        let task = await this.repositories.task.save({
            from,
            to,
            event,
            creator,
            createAt: new Date(),
            content: content ?? '',
        }) as Task

        // FIXME: return taskID
        const taskID = task[EntityId]!

        to.forEach(async e => {
            let toUser = await this.repositories.user.fetch(e) as User
            toUser.tasks.push(taskID)
            toUser = await this.repositories.user.save(toUser) as User
        })

        let fromUser = await this.repositories.user.fetch(from) as User
        fromUser.tracking.push(taskID)
        fromUser = await this.repositories.user.save(fromUser) as User

        return this.returnMsg(true, '任務建立')
    }
    async completedTask(taskID: TaskID) {
        let task = await this.repositories.task.fetch(taskID) as Task

        let fromUser = await this.repositories.user.fetch(task.from) as User
        
        const index = fromUser.tracking.indexOf(taskID)
        if (index >= 0) {
            fromUser.tracking.splice(index, 1)
            await this.repositories.user.save(fromUser)
        }
        // FIXME: 如果沒有對應的taskID
        
        let toUsers = await this.repositories.user.fetch(task.to) as Required<User>[]
        toUsers.forEach(async to => {
            const index = to.tasks.indexOf(taskID)
            if (index >= 0) {
                to.tasks.splice(index, 1)
                await this.repositories.user.save(to)
            }
            // TODO: 如果沒有對應的taskID
        })
        await this.repositories.task.remove(taskID)
        
        return this.returnMsg(true, '任務完成')
    }

    async FriendInvitation(from: UserID, to: UserID) {

        await this.task({
            from, 
            to: to, 
            event: ChatEvents.FriendInvitation
        })
        // TODO: 通知
        // await this.notify({ from, to, event: ChatEvents.FriendInvitation, msg: `來自 ${from} 的好友邀請` })

        return this.returnMsg(true, '已送出好友邀請')
    }
    
    async FriendConfirmation(from: UserID, to: UserID) {

        await this.task({
            from, 
            to    : to, 
            event : ChatEvents.FriendConfirmation
        })

        // TODO: 還沒檢視完成
        const groupID = await this.createDirectGroup(from, to)

        // const multi = this.db.multi()
        // multi.hSet(this.user(from).friends, to, JSON.stringify({ status: 6, groupID }))
        // multi.hSet(this.user(to).friends, from, JSON.stringify({ status: 7, groupID }))
        // const added = await multi.exec()
        // if (added.some(e => e as number <= 0)) return this.returnMsg(false, '資料庫出現問題')

        // await this.completedTask(taskID)

        return this.returnMsg(true, '已添加為好友') 
    }
    async createDirectGroup(user1: UserID, user2: UserID): Promise<GroupID> {

        let group = await this.repositories.group.save({
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

        await this.task({
            creator : inviter,
            from    : groupID,
            to      : invitedMembers, 
            event   : ChatEvents.GroupInvitation,
        })
        // TODO: 通知
        // await this.notify({ from: groupID, to: invitedMembers, event, msg: `${from} 邀請您加入[${groupID}]群組` })
        
        return this.returnMsg(true, '已送出群組邀請')
    }

    async createGroup(name: string, creator: UserID, avatar: string, invitedMembers: UserID[] = []): Promise<GroupID> {
        
        let group = await this.repositories.group.save({
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
        let user = await this.repositories.user.fetch(creator) as User
        user.groups.push(groupID)
        user = await this.repositories.user.save(user) as User

        await this.groupInvitation(creator, groupID, invitedMembers)

        return groupID
    }
    async groupConfirmation(userID: UserID, groupID: GroupID) {

        await this.task({
            creator : userID,
            from    : userID,
            to      : groupID, 
            event   : ChatEvents.GroupConfirmation,
        })

        let user = await this.repositories.user.fetch(userID) as User
        user.groups.push(groupID)
        user = await this.repositories.user.save(user) as User

        let group = await this.repositories.group.fetch(groupID) as Group
        group.members.push(userID)
        group = await this.repositories.group.save(group) as Group

        // TODO: completed task （需確認）
        // await this.completedTask()

        return this.returnMsg(true, '已加入群組') 
    }
    async sendMsg(from: UserID, to: GroupID, content: string): Promise<MessageID> {

        let message = await this.repositories.message.save({
            from,
            to,
            content,
            createAt: new Date(),
            reader: [from]
        }) as Message

        const messageID = message[EntityId] as MessageID

        // FIXME: 兩個方法
        // 1: 直接寫到 group 的 messages 中
        let group = await this.repositories.group.fetch(to) as Group
        group.messages.push(messageID)
        group = await this.repositories.group.save(group) as Group

        // TODO: 通知

        // 2: 寫成 task，等第一個用戶在線再寫到 group 的 messages 中
        await this.task({
            from,
            to,
            creator: from,
            event: ChatEvents.SendMessage,
            content
        })
        // TODO: 通知
        // await this.notify({ from, to, event: ChatEvents.msg, msg: msg })
        
        return messageID
    }
    async readMsg(reader: UserID, messageID: MessageID) {
        let message = await this.repositories.message.fetch(messageID) as Message
        message.readers.push(reader)
        message = await this.repositories.message.save(message) as Message
    }
    async quit() {
        return await this.db.quit()
    }
}

// 生成單例
const Chat = Singleton(ChatBase)

export default Chat