import { createClient } from 'redis';
import bcrypt from 'bcrypt';

// const db = createClient()
// await db.connect()

// const added = await db.hSet('base', 'states', JSON.stringify(states))
// console.log(added)

// await db.disconnect()

// 單例
const Singleton = function (Class) {
    let instance
    return function (...args) {
        return instance || (instance = new Class(...args))
    }
}

class ChatBase {
    constructor(config = {}) {
        this.config = config
        this.db = createClient()
        return (async () => {
            await this.connect()
            return this
        })()
    }
    async hash(data) {
        const saltRounds = 10
        const salt = await bcrypt.genSalt(saltRounds)
        const hashed = await bcrypt.hash(data, salt)
        return hashed
    }
    async connect() {
        await this.db.connect()
    }
    async disconnect() {
        await this.db.disconnect()
    }
    // async checkUserExists(userID) {
    //     return this.db.exists(`users:${userID}`)
    // }
    async createUser({ name, email, password, avatar, ifExists}) {

        const userID = email

        if (await this.db.exists(`users:${userID}`)) return ifExists()
    
        const hashedPassword = await this.hash(password)
    
        const added = await this.db.hSet(`users:${userID}`, {
            name, email, hashedPassword, avatar
        })
    }
    // 通知
    async notify({ from, to, event, ref }) {
        const multi = this.db.multi()
        if (!Array.isArray(to)) to = [to]
        to.forEach(async member => {
            multi.lPush(`${ChatMemberType.users}:${member}:notification`, JSON.stringify({ from, event, ref }))
        })
        return await multi.exec()
    }
    // 待處理任務
    async pendingTasks({ memberType, from, to, event, creator = from, createAt }) {
        return await this.db.hSet(`${memberType}:${to}:pendingTasks:${event}`, from, JSON.stringify({ creator, createAt }))
    }
    // 任務追蹤
    async tasksTracking({ memberType, from, to, event, creator = from, createAt }) {
        return await this.db.hSet(`${memberType}:${from}:tasksTracking:${event}`, to, JSON.stringify({ creator, createAt }))
    }
    async task({ memberType, from, to, event, creator = from }) {
        const createAt = Date.now()
        if (!Array.isArray(to)) to = [to]
        to.forEach(async member => {
            await this.pendingTasks({ memberType, from, to: member, event, creator, createAt })
            await this.tasksTracking({ memberType, from, to: member, event, creator, createAt })
        })
    }
    async completedTask({ memberType, from, to, event }) {
        const multi = this.db.multi()
        multi.hDel(`${memberType}:${to}:pendingTasks:${event}`, from)
        multi.hDel(`${memberType}:${from}:tasksTracking:${event}`, to)
        return await multi.exec()
    }

    async requestFriendship(from, to) {
        const memberType = ChatMemberType.users
        const event = ChatEvents.requestFriendship

        // if (!await this.db.exists(`users:${to}`)) socket.emit('msg', { ok: false, msg: '用戶不存在' })

        // 根據 status
        const status = ['不是好友', '成為好友', '需要被確認', '等待確認', '拒絕', '被拒絕', '確認', '被確認']

        // 將好友關係存儲在伺服器中
        // await this.db.zAdd(`${memberType}:${from}:friends`, { score: 2, value: to })
        // await this.db.zAdd(`${memberType}:${to}:friends`, { score: 3, value: from })

        const multi = this.db.multi()
        multi.hSet(`${memberType}:${from}:friends`, to, JSON.stringify({ status: 2 }))
        multi.hSet(`${memberType}:${to}:friends`, from, JSON.stringify({ status: 3 }))
        await multi.exec()

        await this.task({ memberType, from, to, event })
        await this.notify({ from, to, event: ChatEvents.requestFriendship, ref: null })
    }

    async confirmFriendship(from, to) {
        const memberType = ChatMemberType.users
        const event = ChatEvents.requestFriendship

        // FIXME: 好像是可有可無的設定，需要被確認和等待確認在任務中已經有。
        // await this.db.zAdd(`users:${from}:friends`, { score: 6, value: to })
        // await this.db.zAdd(`users:${to}:friends`, { score: 7, value: from })

        const groupID = await this.createDirectGroup(from, to)

        const multi = this.db.multi()
        multi.hSet(`${memberType}:${from}:friends`, to, { status: 6, groupID })
        multi.hSet(`${memberType}:${to}:friends`, from, { status: 7, groupID })
        await multi.exec()

        await this.completedTask({ from, to, event })
    }

    async createDirectGroup(user1, user2) {
        const groupType = ChatGroupType.directGroups
        // 生成對稱的 Group ID
        const sorted = [user1, user2].sort()
        const GroupID = sorted.join(':')

        const multi = this.db.multi()
        multi.hSet(`${groupType}:${GroupID}:info`, { createAt: Date.now() })
        await multi.exec()
        
        return GroupID
    }
    async groupInvitation({ from, groupID, invitedMembers = [] }) {
        const groupType = ChatGroupType.groups
        const event = ChatEvents.groupInvitation
        // 添加成員





        await this.db.zAdd(`${groupType}:${groupID}:members`, invitedMembers.map(invitedMember => { return { score: 0, value: invitedMember } }))
        await this.task({ from: groupID, to: invitedMembers, event, creator: from })
        await this.notify({ from: groupID, to: invitedMembers, event })
    }
    async createGroup({ name, creator, invitedMembers = [] }) {
        const groupType = ChatGroupType.groups
        // FIXME:
        const groupID = Math.random()
        
        // FIXME:
        const defaultName      = creator + '.group.' + groupID + Math.random()
        const defaultAvatar    = '/'
        const defaultHierarchy = ['invited', 'member', 'administrator', 'creator']

        name      ??= defaultName
        avatar    ??= defaultAvatar
        hierarchy ??= defaultHierarchy

        const multi = this.db.multi()

        // 房間基本資訊
        multi.hSet(`${groupType}:${groupID}:info`, { name, avatar, creator, createAt: Date.now(), hierarchy: JSON.stringify({...roles})})
        // 添加建立者為成員
        multi.zAdd(`${groupType}:${groupID}:members`, { score: 3, value: creator })

        await multi.exec()

        await this.groupInvitation({ from: creator, groupID, invitedMembers })

        return groupID
    }

    static msg(from, to, msg, createAt) {
        return JSON.stringify({ from, to, msg, createAt })
    }
    async sendMsg({ from, to, groupType, msg }) {

        // 訊息儲存到聊天室
        const msgID = await this.db.lPush(`${groupType}:${to}:messages`, JSON.stringify({ from, to, msg, createAt: Date.now() }))
        // 自己先讀了，記錄已讀訊息
        await this.readMsg({ msgID, from, to, groupType })

        const focus = true
        if (focus) {
            // TODO: online send message
        } else {
            await this.notify({ from, to, event: ChatEvents.msg })
        }
        return msgID
    }
    async readMsg({ msgID, from, to, groupType }) {
        return await this.db.lPush(`${groupType}:${to}:messages:${msgID}:read`, from)
    }
    async quit() {
        return await this.db.quit()
    }
}

const ChatEvents = {
    msg: 'msg',
    requestFriendship: 'requestFriendship',
    confirmFriendship: 'confirmFriendship',
    groupInvitation: 'groupInvitation',
}

const ChatMemberType = {
    users: 'users',
    groups: 'groups',
}

const ChatGroupType = {
    directGroups: 'directGroups',
    groups: 'groups',
}

// 生成單例
const Chat = Singleton(ChatBase)

export default Chat