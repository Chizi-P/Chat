import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { parse } from 'cookie'
import jwt from 'jsonwebtoken'
import { ChatError, User } from './DatabaseType.js'
import * as cfg from './.config.js'
import {
    ServerToClientEvents,
    ClientToServerEvents,
    InterServerEvents,
    SocketData
} from './socketioTyping.js'

import { Controller } from "./Controller.js"

const ctl = new Controller()

const app = express()
const httpServer = createServer(app)
const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>(httpServer)

app.use(express.urlencoded({extended: false}))
app.use(express.json())

app.use((req, res, next) => {

})

app.get('/', (req, res) => {
    res.send('api')
})

app.post('/friends', (req, res) => {
    res.send('meow')
})

app.post('/user', (req, res) => {
    req.body
})

const ok  = (msg: string): { ok: boolean, msg: string } => ({ ok: true, msg })
const not = (msg: string): { ok: boolean, msg: string } => ({ ok: false, msg })

// ------------------------------- //

app.post('/register', async (req, res) => {
    const { name, email, password } = req.body
    console.table(req.body)
    // 輸入不能為空
    if (!(name && email && password)) return res.send(not('輸入不能為空'))
    const userID = await ctl.createUser(name, email, password)
    if (userID in ChatError) {
        return res.send(not(userID))
    }
    ctl.log('userID:', userID)

    return res.send(ok('註冊成功'))
})

// OPT
declare module 'jsonwebtoken' {
    export interface UserJwtPayload extends jwt.JwtPayload {
        userID   : string, 
        name     : string, 
        email    : string, 
        createAt : number,
    }
}

io.use(async (socket, next) => {
    const cookies = parse(socket.request.headers.cookie || "")
    // chat.logger('cookies:', cookies)

    let token: string = socket.handshake.headers.token as string || cookies.token
    const { email, password } = socket.handshake.headers as { email?: string, password?: string }
    // console.table(socket.handshake.headers)

    // OPT 
    let payload: jwt.UserJwtPayload | Awaited<ReturnType<typeof ctl.login>>
    // login with token //
    if (token !== undefined) {
        payload = await ctl.login(token)
        if (payload.err !== undefined) return next(new Error('token 驗證失敗'))
    
    // login with email and password //
    } else if (email !== undefined && password !== undefined) {
        payload = await ctl.login(email, password)
        if (payload.err !== undefined) return next(new Error('帳號或密碼錯誤')) // FIXME - error 的類型
        
    } else {
        socket.disconnect(true)
        ctl.log('用戶沒有提供 token 或 email 和 password')
        return next(new Error('用戶沒有提供 token 或 email 和 password'))
    }

    // TODO - 防止多端登錄
    
    // ...
    // TODO - 先強制登出其他位置帳號
    // ...
    // const oldSocketID = user(email, 'socketID')
    // if (oldSocketID) io.sockets.sockets[oldSocketID].disconnect(true)

    // 成功登錄
    // TODO - 回傳 token 給 client
    // ... user.token

    socket.data.userID = payload.userID
    socket.data.name   = payload.name
    socket.data.email  = payload.email

    // OPT - 儲存對應的 socket id
    let user = await ctl.db.repos.user.fetch(payload.userID)
    user.serverUserID = socket.id
    user = await ctl.db.repos.user.save(user)

    ctl.log('[登錄]', socket.data.userID)
    return next()
})

io.on('connection', async socket => {
    ctl.log('[已連接]', socket.data.userID)

    // 讀取離線消息
    // while (true) {
    //     const msg = await ctl.rPop(`${socket.data.userID}OfflineMessageQueue`)
    //     if (msg !== null) socket.emit('msg', { ok: true, msg })
    //     else break
    // }
    let notifications = await ctl.checkForOfflineMessages(socket.data.userID)
    if (notifications.length > 0) {
        socket.emit('notifications', notifications)
    }
    
    let user = await ctl.db.repos.user.fetch(socket.data.userID) as User
    await socket.join(user.groups)

    // 轉發訊息
    socket.on('message', async (toGroupID, content, callback) => {
        const from = socket.data.userID

        ctl.log('[傳訊息]', from, ':', content, '=>', toGroupID)

        io.to(toGroupID).emit('message', from, content)
        await ctl.sendMessage(from, toGroupID, content)

        // OPT to user 有 socketID 的話代表在線
        
        // 在線
        if (true) {
            callback(ok('已傳送'))
        }
        // 不在線
        else {
            callback({ ok: false, message: '用戶不在線' })
            // 發到離線消息隊列
        }
    })

    socket.on('friendInvitation', async (to, callback) => {

        // TODO - 判斷 to user 是否存在

        const from = socket.data.userID

        let user = await ctl.db.repos.user.fetch(to)
        const toSocketID = user.serverUserID as string

        // if (!await ctl.exists(`users:${to}`)) socket.emit('msg', { ok: false, msg: '用戶不存在' })

        // // 根據 states
        // const states = ['不是好友', '成為好友', '需要確認', '等待確認', '拒絕', '被拒絕', '確認', '被確認']

        // 將好友關係存儲在伺服器中
        // await ctl.hSet(`users:${from}:friends`, to, 2)
        // await ctl.hSet(`users:${to}:friends`, to, 3)
        
        // 通知發送請求的用戶，好友已經被成功添加
        // socket.emit('msg', { ok: true, msg: `已請求添加 ${to} 為好友`, system: true })

        await ctl.FriendInvitation(from, to)

        io.to(toSocketID).emit('friendInvitation', from)
        // socket.to(toSocketID).emit('friendInvitation', from)

        // 如果對方也在線上，通知對方有人想添加他為好友
        // io.to(await user(to, 'socketID')).emit('friendRequest', { ok: true, msg: `${from} 把您設為好友`, system: true })

        callback(ok('已發送好友邀請'))
    })

    socket.on('groupInvitation',async (groupID, invitedMembers) => {
        const inviter = socket.data.userID
        await ctl.groupInvitation(inviter, groupID, invitedMembers)
    })

    socket.on('confirm', async taskID => {
        await ctl.finishTask(taskID)
    })

    socket.on('disconnect', async () => {
        // 刪除 socketID
        let user = await ctl.db.repos.user.fetch(socket.data.userID)
        user.isOnline = false
        user.serverUserID = ''
        user = await ctl.db.repos.user.save(user)
        ctl.log('[已離線]', socket.data.userID)
    })

})

// 啟動伺服器監聽指定的埠號
const PORT = process.env.PORT || 3000
httpServer.listen(PORT, () => {
    ctl.log(`伺服器正在監聽埠號 ${PORT}`)
})

