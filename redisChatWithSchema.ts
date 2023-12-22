import { createClient, RedisClientType, RedisClientOptions } from 'redis'
import bcrypt from 'bcrypt'
// import { v5 as uuidv5 } from 'uuid'
import { Repository, Entity, EntityId } from 'redis-om'
import { createRepositories, RepositoriesType, RepositoriesDataType } from './schema'

// 單例
function Singleton<T>(Class: new (...args: any[]) => T): (...args: any[]) => T {
    let instance: T | undefined
    return (...args: any[]): T => instance || (instance = new Class(...args))
}

type UserIDType = string
type GroupIDType = string
type UserType         = RepositoriesDataType['user']
type GroupType        = RepositoriesDataType['group']
type MessageType      = RepositoriesDataType['message']
type NotificationType = RepositoriesDataType['notification']
type TaskType         = RepositoriesDataType['task']

enum ChatEvents {
    msg                    = 'msg',
    requestFriendship      = 'requestFriendship',
    confirmFriendship      = 'confirmFriendship',
    groupInvitation        = 'groupInvitation',
    confirmGroupInvitation = 'confirmGroupInvitation',
}

enum ChatMemberType {
    users  = 'users',
    groups = 'groups',
}

class ChatBase {
    
    private db: RedisClientType
    private options?: RedisClientOptions
    isSaveLog: boolean = true

    repositories: RepositoriesType

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

    // TODO: 
    logger(): void {
        if (!this.logger) return
        // TODO: save log message
    }
    async hash(data: string | Buffer): Promise<string> {
        const saltRounds = 10
        const salt = await bcrypt.genSalt(saltRounds)
        return await bcrypt.hash(data, salt)
    }
    private returnMsg(ok: boolean, msg: string): { ok: boolean, msg: string } {
        console.table({ ok, msg })
        return { ok, msg }
    }
    private user(userID: UserIDType): string {
        const prefix = `${this.users.prefix}:${userID}`

        const suffix = {
            info          : 'info', 
            friends       : 'friends',
            groups        : 'groups',
            notification  : 'notification',
            pendingTasks  : (event: string): string => event,
            tasksTracking : (event: string): string => event,
        }

        Object.entries(suffix).forEach(([key, val]) => {
            if      (typeof val === 'string')   prefix.__proto__[key] = `${prefix}:${key}`
            else if (typeof val === 'function') prefix.__proto__[key] = (...args: any)=> `${prefix}:${key}:${val(...args)}`
        })
        return prefix
    }

    private group(groupID: GroupIDType): string {
        const prefix = `${this.groups.prefix}:${groupID}`
        const suffix = {
            info          : 'info', 
            members       : 'members',
            messages      : (msgID: string): object => ({read: `${msgID}:read`}),
            pendingTasks  : (event: string): string => event,
            tasksTracking : (event: string): string => event,
        }

        Object.entries(suffix).forEach(([key, val]) => {
            if (typeof val === 'string')        prefix.__proto__[key] = `${prefix}:${key}`
            else if (typeof val === 'function') prefix.__proto__[key] = (...args: any) => `${prefix}:${key}:${val(...args)}`
        })
        
        return prefix
    }
    userUUID(email: UserType['email']) {
        
    }
    groupUUID(...members: UserIDType[]): GroupIDType {
        const name: string[] = [Date.now().toString(), ...members.sort()]
        // FIXME: type of name error
        return uuidv5(name as any, this.groups.uuid.namespace) as unknown as GroupIDType
    }
    async connect() {
        await this.db.connect()
        return this
    }
    async disconnect() {
        await this.db.disconnect()
        return this
    }
    async createUser(userData: UserType) {
        const { name, email, password, avatar } = userData

        let saveUserData: UserType = {
            name, 
            email, 
            hashedPassword: await this.hash(password),
            avatar,
            createAt: new Date(),
            groups: [],
            notifications: []
        }

        if (await this.repositories.user.search().where('email').eq(email).count() > 0) return this.returnMsg(false, '用戶已存在')
        saveUserData = await this.repositories.user.save(saveUserData)
        // const userID = saveUserData[EntityId] as UserIDType

        return this.returnMsg(true, '註冊成功')
    }
    // 通知
    async notify(notification: NotificationType) {
        const { from, event, msg } = notification
        let to = notification.to
        to = Array.isArray(to) ? to : [to]
        const multi = this.db.multi()
        if (!Array.isArray(to)) to = [to]
        to.forEach(async member => {
            multi.lPush(this.user(member).notification, JSON.stringify({ from, event, msg }))
        })
        const replies = await multi.exec()
        if (replies.some(e => e as number <= 0)) return this.returnMsg(false, '資料庫出現問題')
        return this.returnMsg(true, '已發送通知')
    }
    // 待處理任務
    // async pendingTasks({ memberType, from, to, event, creator = from, createAt }) {
    //     return await this.db.hSet(`${memberType}:${to}:pendingTasks:${event}`, from, JSON.stringify({ creator, createAt }))
    // }
    // 任務追蹤
    // async tasksTracking({ memberType, from, to, event, creator = from, createAt }) {
    //     return await this.db.hSet(`${memberType}:${from}:tasksTracking:${event}`, to, JSON.stringify({ creator, createAt }))
    // }
    async task(task: TaskType) {
        const { memberType, from, event } = task
        const creator = task.creator ?? from
        let to = task.to
        to = Array.isArray(to) ? to : [to]
        const createAt = Date.now()
        const multi = this.db.multi()
        const obj =  memberType === ChatMemberType.users ? this.user : this.group
        to.forEach(member => {
            multi.hSet(obj(member).pendingTasks(event), from, JSON.stringify({ creator, createAt }))
            multi.hSet(obj(from).tasksTracking(event), member, JSON.stringify({ creator, createAt }))
        })
        const replies = await multi.exec()
        if (replies.some(e => e as number <= 0)) return this.returnMsg(false, '資料庫出現問題')
        return this.returnMsg(true, '任務建立')
    }
    async completedTask(task: TaskType) {
        const { memberType, from, event } = task
        let to = task.to
        to = Array.isArray(to) ? to : [to]
        const multi = this.db.multi()
        const obj =  memberType === ChatMemberType.users ? this.user : this.group
        to.forEach(member => {
            multi.hDel(obj(member).pendingTasks(event), from)
            multi.hDel(obj(from).tasksTracking(event), member)
        })
        const replies = await multi.exec()
        if (replies.some(e => e as number <= 0)) return this.returnMsg(false, '資料庫出現問題')
        return this.returnMsg(true, '任務完成')
    }

    async requestFriendship(from: UserIDType, to: UserIDType) {
        const memberType = ChatMemberType.users
        const event      = ChatEvents.requestFriendship

        // if (!await this.db.exists(`users:${to}`)) socket.emit('msg', { ok: false, msg: '用戶不存在' })

        // 根據 status
        const status = ['不是好友', '成為好友', '需要被確認', '等待確認', '拒絕', '被拒絕', '確認', '被確認']

        const multi = this.db.multi()
        // 將好友關係存儲在伺服器中
        multi.hSet(this.user(from).friends, to, JSON.stringify({ status: 2 }))
        multi.hSet(this.user(to).friends, from, JSON.stringify({ status: 3 }))
        const added = await multi.exec()
        if (added.some(e => e as number <= 0)) return this.returnMsg(false, '資料庫出現問題')

        await this.task({ memberType, from, to, event })
        await this.notify({ from, to, event: ChatEvents.requestFriendship, msg: `來自 ${from} 的好友邀請` })
        return this.returnMsg(true, '已送出好友邀請')
    }
    

    async confirmFriendship(from: UserIDType, to: UserIDType) {
        const memberType = ChatMemberType.users
        const event      = ChatEvents.requestFriendship

        const groupID = await this.createDirectGroup(from, to)

        const multi = this.db.multi()
        multi.hSet(this.user(from).friends, to, JSON.stringify({ status: 6, groupID }))
        multi.hSet(this.user(to).friends, from, JSON.stringify({ status: 7, groupID }))
        const added = await multi.exec()
        if (added.some(e => e as number <= 0)) return this.returnMsg(false, '資料庫出現問題')

        await this.completedTask({ memberType, from, to, event })
        return this.returnMsg(true, '已添加為好友') 
    }

    async createDirectGroup(user1: UserIDType, user2: UserIDType): Promise<GroupIDType> {
        const groupID = this.groupUUID(user1, user2)

        const multi = this.db.multi()
        multi.hSet(this.group(groupID).info, { 
            creator: this.system.id, 
            isDirect: true, 
            createAt: Date.now(),
        })
        multi.hSet(this.group(groupID).members, {
            [user1]: JSON.stringify({some: 'json'}),
            [user2]: JSON.stringify({some: 'json'})
        })
        const added = await multi.exec()
        if (added.some(e => e as number <= 0)) return this.returnMsg(false, '資料庫出現問題')
        return groupID
    }

    async groupInvitation(from: UserIDType, groupID: GroupIDType, invitedMembers: UserIDType[]) {
        if (!invitedMembers.length) return
        const memberType = ChatMemberType.groups
        const event = ChatEvents.groupInvitation

        const multi = this.db.multi()

        invitedMembers.forEach(invitedMember => {
            multi.hSetNX(this.group(groupID).members, invitedMember, JSON.stringify({ status: 0 }))
        })
        const added = await multi.exec()
        if (added.some(e => e as number <= 0)) return this.returnMsg(false, '有些用戶已經邀請過')

        await this.task({ 
            memberType,
            from    : groupID, 
            to      : invitedMembers,
            event,
            creator : from 
        })
        // FIXME: 少了 creator 的信息
        await this.notify({ from: groupID, to: invitedMembers, event, msg: `${from} 邀請您加入[${groupID}]群組` })
        return this.returnMsg(true, '已送出群組邀請')
    }

    async createGroup(groupData: GroupType, invitedMembers: UserIDType[] = []) {
        const { name, creator } = groupData
        const groupID = this.groupUUID(creator)
        
        const multi = this.db.multi()
        // 房間基本資訊
        multi.hSet(this.group(groupID).info, { 
            creator  : creator, 
            name     : name ?? this.groups.default.name(creator), 
            avatar   : this.groups.default.avatar, 
            createAt : Date.now(), 
            hierarchy: JSON.stringify({...this.groups.default.hierarchy}),
            isDirect : false, 
        })
        
        // 先添加建立者為成員
        multi.hSet(this.group(groupID).members, creator, JSON.stringify({ status: 3 }))
        multi.hSet(this.user(creator).groups, groupID, JSON.stringify({ some: 'json' }))

        const added = await multi.exec()
        if (added.some(e => e as number <= 0)) return this.returnMsg(false, '資料庫出現問題')

        await this.groupInvitation(creator, groupID, invitedMembers)

        return groupID
    }
    async confirmGroupInvitation(userID: UserIDType, groupID: GroupIDType) {
        const memberType = ChatMemberType.groups
        const event = ChatEvents.confirmGroupInvitation

        const multi = this.db.multi()
        multi.hSet(this.user(userID).groups, groupID, JSON.stringify({ some: 'json' }))

        multi.hSet(this.group(groupID).members, userID, JSON.stringify({ some: 'json' }))
        const added = await multi.exec()
        if (added.some(e => e as number <= 0)) return this.returnMsg(false, '資料庫出現問題')

        await this.completedTask({ memberType, from: userID, to: groupID, event })
        return this.returnMsg(true, '已加入群組') 
    }
    async sendMsg(msgData: MessageDataType): Promise<number> {
        const { from, to, msg } = msgData
        // 訊息儲存到聊天室
        const msgID = await this.db.lPush(this.group(to).messages, JSON.stringify({ from, to, msg, createAt: Date.now() }))
        // 自己先已讀訊息
        await this.readMsg({ msgID, from, to })

        const focus = false
        if (focus) {
            // TODO: online send message
        } else {
            await this.notify({ from, to, event: ChatEvents.msg, msg: msg })
        }
        return msgID
    }
    async readMsg({ msgID, from, to }) {
        return await this.db.lPush(this.group(to).messages(msgID).read, from)
    }
    async quit() {
        return await this.db.quit()
    }
}

// 生成單例
const Chat = Singleton(ChatBase)

export default Chat