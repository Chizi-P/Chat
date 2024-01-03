import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { parse } from 'cookie'
import jwt from 'jsonwebtoken'

import publicRoutes from './router/publicRoutes.js'
import protectedRoutes from './router/protectedRoutes.js'
import { ok, not } from './router/func.js'

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

// 掛載路由
app.use('/api/public', publicRoutes)
app.use('/api/protected', protectedRoutes)

// ------------------------------- //

io.use(async (socket, next) => {
    const cookies = parse(socket.request.headers.cookie || "")

    let token: string = socket.handshake.headers.token as string || cookies.token
    const { email, password } = socket.handshake.headers as { email?: string, password?: string }

    // OPT 類型錯誤
    let payload: jwt.UserJwtPayload | Awaited<ReturnType<typeof ctl.login>>

    // login with token //
    if (token || (email && password)) {
        payload = await ctl.login({ token, email, password})
        if (payload.err !== undefined) return next(new Error('驗證失敗'))
    } else {
        socket.disconnect(true)
        ctl.log('用戶沒有提供 token 或 email 和 password')
        return next(new Error('用戶沒有提供 token 或 email 和 password'))
    }

    // if (token !== undefined) {
    //     payload = await ctl.login(token)
    //     if (payload.err !== undefined) return next(new Error('token 驗證失敗'))
    
    // // login with email and password //
    // } else if (email !== undefined && password !== undefined) {
    //     payload = await ctl.login(email, password)
    //     if (payload.err !== undefined) return next(new Error('帳號或密碼錯誤')) // FIXME - error 的類型
    // } 

    // 用戶成功登錄，獲取用戶資料
    let user = await ctl.getData('user', payload.userID)

    // 防止多端登錄 先強制登出相同帳號
    if (user.serverUserID) io.sockets.sockets.get(user.serverUserID)?.disconnect(true)

    // 成功登錄
    // TODO - 回傳 token 給 client
    // ... user.token

    socket.data.userID = payload.userID
    socket.data.name   = payload.name
    socket.data.email  = payload.email

    // 儲存對應的 socket id
    user = await ctl.setUser(payload.userID, { serverUserID: socket.id })

    ctl.log('[登錄]', socket.data.userID)
    return next()
})

io.on('connection', async socket => {
    
    const userID = socket.data.userID
    const userName = socket.data.name

    ctl.log('[已連接] userID: ', userID, " name: ", userName)

    // 讀取離線消息
    // while (true) {
    //     const msg = await ctl.rPop(`${socket.data.userID}OfflineMessageQueue`)
    //     if (msg !== null) socket.emit('msg', { ok: true, msg })
    //     else break
    // }
    let notifications = await ctl.checkForOfflineMessages(userID)
    if (notifications.length > 0) {
        socket.emit('notifications', notifications)
    }
    
    // 聆聽群組
    let user = await ctl.getData('user', userID)
    await socket.join(user.groups)

    // 轉發訊息
    socket.on('message', async (toGroupID, content, callback) => {
        const from = socket.data.userID

        ctl.log('[傳訊息]', from, ':', content, '=>', toGroupID)

        // io.to(toGroupID).emit('message', from, content)
        io.to(toGroupID).emit('message', toGroupID, from, content, res => {
            if (res?.ok) {
                console.log('已轉發')
            } else {
                console.log('轉發失敗')
            }
        })
        await ctl.sendMessage(from, toGroupID, content)
        callback?.(ok('已發送'))
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

        callback?.(ok('已發送好友邀請'))
    })

    socket.on('groupInvitation',async (groupID, invitedMembers) => {
        const inviter = socket.data.userID
        await ctl.groupInvitation(inviter, groupID, invitedMembers)
    })

    // TODO: 判斷 task 是否屬於這個用戶
    socket.on('confirm', async taskID => {
        console.log('confirm', taskID)
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

