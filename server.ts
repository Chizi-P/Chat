import express, { Router } from 'express'
import { createServer } from 'http'
import os from 'os'
import { Server } from 'socket.io'
import { parse } from 'cookie'
import jwt from 'jsonwebtoken'

import { Controller }    from "./Controller.js"
import { validateToken } from './src/controllers/middleware.js'
import { login }         from './src/controllers/usersControllers.js'
import usersRouter       from './src/routes/usersRoutes.js'
import groupsRouter      from './src/routes/groupsRoutes.js'
import messagesRouter    from './src/routes/messagesRoutes.js'
import tasksRouter       from './src/routes/tasksRoutes.js'
import filesRouter       from './src/routes/filesRoutes.js'

import { User } from './DatabaseType.js'

import {
    ServerToClientEvents,   
    ClientToServerEvents,
    InterServerEvents,
    SocketData
} from './socketioTyping.js'

export const ctl = new Controller()

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

const api = Router()

app.use('/api/v1', api)

api.use((req, res, next) => {
    ctl.log('收到請求:', req.method, req.url)
    req.body ?? console.table(req.body)
    next()
})

api.post('/login', login)
api.use(validateToken)
api.use(usersRouter)
api.use(groupsRouter)
api.use(messagesRouter)
api.use(tasksRouter)
api.use(filesRouter)

// ------------------------------- //

io.use(async (socket, next) => {
    const cookies = parse(socket.request.headers.cookie || "")

    let token: string = socket.handshake.headers.token as string || cookies.token
    const { email, password } = socket.handshake.headers as { email?: string, password?: string }

    // OPT 類型錯誤
    let payload: jwt.UserJwtPayload | Awaited<ReturnType<typeof ctl.login>>

    // login //
    if (token || (email && password)) {
        payload = await ctl.login({ token, email, password })
        if (payload.err !== undefined) return next(new Error('驗證失敗'))
    } else {
        socket.disconnect(true)
        const err = '用戶沒有提供 token 或 email 和 password'
        ctl.log(err)
        return next(new Error(err))
    }

    // 用戶成功登錄，獲取用戶資料
    let user = await ctl.getData('user', payload.userID)
    // 防止多端登錄 先強制登出相同帳號
    if (user.serverUserID) io.sockets.sockets.get(user.serverUserID)?.disconnect(true)
    // 成功登錄
    socket.data.userID = payload.userID
    socket.data.name   = payload.name
    socket.data.email  = payload.email
    // 儲存對應的 socket id
    user = await ctl.setUser(payload.userID, { serverUserID: socket.id })
    ctl.log(`[登錄] user: ${socket.data.userID}`)
    return next()
})

io.on('connection', async socket => {
    
    const userID   = socket.data.userID
    const userName = socket.data.name
    ctl.log(`[已連接] user: ${userID} name: ${userName}`)

    // 讀取離線消息
    const notifications = await ctl.checkForOfflineMessages(userID)
    if (notifications.length > 0) {
        socket.emit('notifications', notifications)
    }
    
    // 聆聽群組
    const user = await ctl.getData('user', userID) as User
    await socket.join([...user.groups, ...user.directGroups])

    // 轉發訊息
    socket.on('message', async (toGroupID, type, content, callback) => {
        const from = socket.data.userID
        const message = await ctl.createMessage(from, toGroupID, type, content)
        io.to(toGroupID).emit('message', message)
        ctl.log(`[傳訊息] group: ${toGroupID} user: ${from}: ${content}`)
        callback?.({ ok: true, msg: '已發送' })
    })

    socket.on('friendInvitation', async (to, callback) => {

        // TODO - 判斷 to user 是否存在

        const from = socket.data.userID
        const user = await ctl.db.repos.user.fetch(to)
        const toSocketID = user.serverUserID as string
        await ctl.FriendInvitation(from, to)
        io.to(toSocketID).emit('friendInvitation', from)
        // socket.to(toSocketID).emit('friendInvitation', from)

        // 如果對方也在線上，通知對方有人想添加他為好友
        // io.to(await user(to, 'socketID')).emit('friendRequest', { ok: true, msg: `${from} 把您設為好友`, system: true })
        callback?.({ ok: true, msg: '已發送好友邀請' })
    })

    socket.on('groupInvitation',async (groupID, invitedMembers) => {
        const inviter = socket.data.userID
        await ctl.groupInvitation(inviter, groupID, invitedMembers)
    })

    // TODO: 判斷 task 是否屬於這個用戶
    socket.on('confirm', async taskID => {
        ctl.log('confirm', taskID)
        await ctl.finishTask(taskID)
    })

    socket.on('disconnect', async () => {
        // 刪除 socketID
        let user = await ctl.db.repos.user.fetch(socket.data.userID)
        user.isOnline     = false
        user.serverUserID = ''
        user = await ctl.db.repos.user.save(user)
        ctl.log('[已離線]', socket.data.userID)
    })

})

const PORT = process.env.PORT || 3000
httpServer.listen(PORT, () => {
    ctl.log(`伺服器 - ${os.networkInterfaces()['Wi-Fi']?.filter(e => e.family === 'IPv4')[0].address ?? 'localhost'}:${PORT}`)
})

