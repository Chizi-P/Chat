import { createClient } from 'redis';
import bcrypt from 'bcrypt';
import { v5 as uuidv5 } from 'uuid';

// 單例
const Singleton = function (Class) {
    let instance
    return function (...args) {
        return instance || (instance = new Class(...args))
    }
}

class ChatBase {
    
    #db;
    
    config = {}
    isSaveLog = true

    constructor(config = {}) {
        this.config = config
        this.#db = createClient()
        this.#db.on('error', err => console.log('Redis Client Error', err))
        this.#db.on('connect', () => console.log('Redis client connected'))
        this.#db.on('end', () => console.log('Redis client disconnected'))
    }
    users = {
        uuid    : { namespace: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' },
        prefix  : 'users',
        default : {
            avatar: '/',
        }
    }
    groups = {
        uuid    : { namespace: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' },
        prefix  : 'groups',
        default : {
            name      : creator => `${creator} 創建的群組:${Date.now()}`,
            avatar    : '/',
            hierarchy : ['invited', 'member', 'administrator', 'creator'],
        },
        
    }
    system = {
        id: 'system'
    }
    async #hash(data) {
        const saltRounds = 10
        const salt = await bcrypt.genSalt(saltRounds)
        return await bcrypt.hash(data, salt)
    }
    #returnMsg(ok, msg) {
        console.table({ ok, msg })
        return { ok, msg }
    }
    #user(userID) {
        const prefix = `${this.users.prefix}:${userID}`

        const suffix = {
            info          : 'info', 
            friends       : 'friends',
            groups        : 'groups',
            notification  : 'notification',
            pendingTasks  : event => event,
            tasksTracking : event => event,
        }

        Object.entries(suffix).forEach(([key, val]) => {
            if      (typeof val === 'string')   prefix.__proto__[key] = `${prefix}:${key}`
            else if (typeof val === 'function') prefix.__proto__[key] = (...args) => `${prefix}:${key}:${val(...args)}`
        })
        return prefix
    }

    #group(groupID) {
        const prefix = `${this.groups.prefix}:${groupID}`
        const suffix = {
            info          : 'info', 
            members       : 'members',
            messages      : msgID => ({read: `${msgID}:read`}),
            pendingTasks  : event => event,
            tasksTracking : event => event,
        }

        Object.entries(suffix).forEach(([key, val]) => {
            if (typeof val === 'string')        prefix.__proto__[key] = `${prefix}:${key}`
            else if (typeof val === 'function') prefix.__proto__[key] = (...args) => `${prefix}:${key}:${val(...args)}`
        })
        return prefix
    }
    groupUUID(...members) {
        const name = [Date.now(), ...members.sort()]
        return uuidv5(name, this.groups.uuid.namespace)
    }
    async connect() {
        await this.#db.connect()
        return this
    }
    async disconnect() {
        await this.#db.disconnect()
        return this
    }
    async createUser({ name, email, password, avatar }) {

        const userID = email
        if (await this.#db.exists(this.#user(userID))) return this.#returnMsg(false, '用戶已存在')
        const added = await this.#db.hSet(this.#user(userID).info, {
            name, 
            email, 
            hashedPassword : await this.#hash(password), 
            avatar         : avatar ?? this.users.default.avatar,
            createAt       : Date.now(),
        })
        if (added <= 0) return this.#returnMsg(false, '資料庫出現問題')
        return this.#returnMsg(true, '註冊成功')
    }
    // 通知
    async notify({ from, to, event, msg }) {
        const multi = this.#db.multi()
        if (!Array.isArray(to)) to = [to]
        to.forEach(async member => {
            multi.lPush(this.#user(member).notification, JSON.stringify({ from, event, msg }))
        })
        const replies = await multi.exec()
        if (replies.some(e => e < 1)) return this.#returnMsg(false, '資料庫出現問題')
        return this.#returnMsg(true, '已通知')
    }
    // 待處理任務
    // async pendingTasks({ memberType, from, to, event, creator = from, createAt }) {
    //     return await this.#db.hSet(`${memberType}:${to}:pendingTasks:${event}`, from, JSON.stringify({ creator, createAt }))
    // }
    // 任務追蹤
    // async tasksTracking({ memberType, from, to, event, creator = from, createAt }) {
    //     return await this.#db.hSet(`${memberType}:${from}:tasksTracking:${event}`, to, JSON.stringify({ creator, createAt }))
    // }
    async task({ memberType, from, to, event, creator = from }) {
        const createAt = Date.now()
        if (!Array.isArray(to)) to = [to]
        const multi = this.#db.multi()
        const obj =  memberType === ChatMemberType.users ? this.#user : this.#group
        to.forEach(member => {
            multi.hSet(obj(member).pendingTasks(event), from, JSON.stringify({ creator, createAt }))
            multi.hSet(obj(from).tasksTracking(event), member, JSON.stringify({ creator, createAt }))
        })
        const replies = await multi.exec()
        if (replies.some(e => e <= 0)) return this.#returnMsg(false, '資料庫出現問題')
        return this.#returnMsg(true, '任務建立')
    }
    async completedTask({ memberType, from, to, event }) {
        if (!Array.isArray(to)) to = [to]
        const multi = this.#db.multi()
        const obj =  memberType === ChatMemberType.users ? this.#user : this.#group
        to.forEach(member => {
            multi.hDel(obj(member).pendingTasks(event), from)
            multi.hDel(obj(from).tasksTracking(event), member)
        })
        const replies = await multi.exec()
        if (replies.some(e => e <= 0)) return this.#returnMsg(false, '資料庫出現問題')
        return this.#returnMsg(true, '任務完成')
    }

    async requestFriendship(from, to) {
        const memberType = ChatMemberType.users
        const event = ChatEvents.requestFriendship

        // if (!await this.#db.exists(`users:${to}`)) socket.emit('msg', { ok: false, msg: '用戶不存在' })

        // 根據 status
        const status = ['不是好友', '成為好友', '需要被確認', '等待確認', '拒絕', '被拒絕', '確認', '被確認']

        const multi = this.#db.multi()
        // 將好友關係存儲在伺服器中
        multi.hSet(this.#user(from).friends, to, JSON.stringify({ status: 2 }))
        multi.hSet(this.#user(to).friends, from, JSON.stringify({ status: 3 }))
        const added = await multi.exec()
        if (added.some(e => e <= 0)) return this.#returnMsg(false, '資料庫出現問題')

        await this.task({ memberType, from, to, event })
        await this.notify({ from, to, event: ChatEvents.requestFriendship, msg: `來自 ${from} 的好友邀請` })
        return this.#returnMsg(true, '已送出好友邀請')
    }

    async confirmFriendship(from, to) {
        const event = ChatEvents.requestFriendship

        const groupID = await this.createDirectGroup(from, to)

        const multi = this.#db.multi()
        multi.hSet(this.#user(from).friends, to, JSON.stringify({ status: 6, groupID }))
        multi.hSet(this.#user(to).friends, from, JSON.stringify({ status: 7, groupID }))
        const added = await multi.exec()
        if (added.some(e => e <= 0)) return this.#returnMsg(false, '資料庫出現問題')

        await this.completedTask({ from, to, event })
        return this.#returnMsg(true, '已添加為好友') 
    }

    async createDirectGroup(user1, user2) {
        const groupID = this.groupUUID(user1, user2)

        const multi = this.#db.multi()
        multi.hSet(this.#group(groupID).info, { 
            creator: 'system', 
            isDirect: true, 
            createAt: Date.now(),
        })
        multi.hSet(this.#group(groupID).members, {
            [user1]: JSON.stringify({some: 'json'}),
            [user2]: JSON.stringify({some: 'json'})
        })
        const added = await multi.exec()
        if (added.some(e => e <= 0)) return this.#returnMsg(false, '資料庫出現問題')
        return groupID
    }

    async groupInvitation({ from, groupID, invitedMembers = [] }) {
        const event = ChatEvents.groupInvitation

        const multi = this.#db.multi()

        invitedMembers.forEach(invitedMember => {
            multi.hSetNX(this.#group(groupID).members, invitedMember, JSON.stringify({ status: 0 }))
        })
        const added = await multi.exec()
        if (added.some(e => e <= 0)) return this.#returnMsg(false, '有些用戶已經邀請過')

        await this.task({ from: groupID, to: invitedMembers, event, creator: from })
        // FIXME: 少了 creator 的信息
        await this.notify({ from: groupID, to: invitedMembers, event, msg: `${from} 邀請您加入[${groupID}]群組` })
        return this.#returnMsg(true, '已送出群組邀請')
    }

    async createGroup({ name, creator, invitedMembers = [] }) {

        const groupID = this.groupUUID(creator)
        
        const multi = this.#db.multi()
        // 房間基本資訊
        multi.hSet(this.#group(groupID).info, { 
            creator  : creator, 
            name     : name ?? this.groups.default.name(creator), 
            avatar   : this.groups.default.avatar, 
            createAt : Date.now(), 
            hierarchy: JSON.stringify({...this.groups.default.hierarchy}),
            isDirect : false, 
        })
        
        // 先添加建立者為成員
        multi.hSet(this.#group(groupID).members, creator, JSON.stringify({ status: 3 }))
        multi.hSet(this.#user(creator).groups, groupID, JSON.stringify({ some: 'json' }))

        const added = await multi.exec()
        if (added.some(e => e <= 0)) return this.#returnMsg(false, '資料庫出現問題')

        await this.groupInvitation({ from: creator, groupID, invitedMembers })

        return groupID
    }
    async confirmGroupInvitation(userID, groupID) {
        const event = ChatEvents.confirmGroupInvitation

        const multi = this.#db.multi()
        multi.hSet(this.#user(userID).groups, groupID, JSON.stringify({ some: 'json' }))

        multi.hSet(this.#group(groupID).members, userID, JSON.stringify({ some: 'json' }))
        const added = await multi.exec()
        if (added.some(e => e <= 0)) return this.#returnMsg(false, '資料庫出現問題')

        await this.completedTask({ from, to, event })
        return this.#returnMsg(true, '已加入群組') 
    }
    async sendMsg({ from, to, msg }) {

        // 訊息儲存到聊天室
        const msgID = await this.#db.lPush(this.#group(to).messages, JSON.stringify({ from, to, msg, createAt: Date.now() }))
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
        return await this.#db.lPush(this.#group(to).messages(msgID).read, from)
    }
    async quit() {
        return await this.#db.quit()
    }
}

const ChatEvents = {
    msg                    : 'msg',
    requestFriendship      : 'requestFriendship',
    confirmFriendship      : 'confirmFriendship',
    groupInvitation        : 'groupInvitation',
    confirmGroupInvitation : 'confirmGroupInvitation',
}

const ChatMemberType = {
    users: 'users',
    groups: 'groups',
}

// 生成單例
const Chat = Singleton(ChatBase)

export default Chat