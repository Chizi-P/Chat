import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { parse } from 'cookie';
import jwt from 'jsonwebtoken';
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

import { createClient } from 'redis';

const db = createClient()
db.on('error', err => console.log('Redis Client Error', err))
db.on('connect', () => console.log('Redis client connected'))
db.on('end', () => console.log('Redis client disconnected'))
await db.connect()

app.use(express.urlencoded({extended: false}))
app.use(express.json())

app.get('/', (req, res) => {
    res.send('api')
})

const ok  = (msg: string): { ok: boolean, msg: string } => ({ ok: true, msg })
const not = (msg: string): { ok: boolean, msg: string } => ({ ok: false, msg })

// async function hash(data) {
//     const saltRounds = 10
//     const salt = await bcrypt.genSalt(saltRounds)
//     const hashed = await bcrypt.hash(data, salt)
//     return hashed
// }

// async function user(email, field) {
//     return await db.hGet(`users:${email}`, field)
// }

// ------------------------------- //
import { Chat, ChatError } from './redisChatWithSchema'
const chat = await Chat().connect()

app.post('/register', async (req, res) => {
    const { name, email, password } = req.body
    // 輸入不能為空
    if (!(name && email && password)) return res.send(not('輸入不能為空'))

    const userID = await chat.createUser(name, email, password)

    return res.send(ok('註冊成功'))
})

io.use(async (socket, next) => {
    
    const cookies = parse(socket.request.headers.cookie || "")
    let token = socket.handshake.auth.token || cookies.token

    // login with token
    // FIXME - 考慮要不要放到 Chat class 裡面
    if (token) {
        jwt.verify(token, '###', function (err, decoded) {
            if (err) return console.error(err)
            socket.decoded = decoded
        })
        // 驗證 token ...
        return next()
    }

    // login with email and password
    const { email, password } = socket.handshake.auth
    
    const res = await chat.login(email, password)
    if (!res.err) {
        token = res.token
    }

    // TODO - 防止多端登錄
    // TODO - 先強制登出其他位置帳號
    // const oldSocketID = user(email, 'socketID')
    // if (oldSocketID) io.sockets.sockets[oldSocketID].disconnect(true)

    // 成功登錄
    jwt.decode()

    socket.user.name  = await user(email, 'name')
    socket.user.email = email
    socket.user.id    = email
    // 儲存對應的 socket id
    const added = await db.hSet(`users:${email}`, 'socketID', socket.id)
    console.log('登錄成功:', email)
    return next()
});

io.on('connection', async socket => {
    console.log(socket.user.name, '已登錄');

    // 讀取離線消息
    while (true) {
        const msg = await db.rPop(`${socket.user.id}OfflineMessageQueue`)
        if (msg !== null) socket.emit('msg', { ok: true, msg })
        else break
    }
    
    // 轉發訊息
    socket.on('msg', async (data, callback) => {
        const { to, msg } = data;
        const from = socket.user.id
        
        const toSocketID = await user(to, 'socketID')
        
        if (toSocketID) io.to(toSocketID).emit('msg', { from: socket.user.id, msg })
        else {
            callback( {ok: false, msg: '用戶不在線'} )
            // 發到離線消息隊列
            await db.lPush(`${to}OfflineMessageQueue`, JSON.stringify({ from, msg, msgID: 'TODO - set a uuid' }))
        }
    })

    socket.on('joinRoom', (data, callback) => {
        const { room } = data
        socket.join(room)
        io.to(room).emit('msg', { text: `用戶 ${socket.id} 加入了房間 ${room}`, system: true })
    })

    socket.on('addFriend', async data => {
        const { to } = data
        const from = socket.user.id

        if (!await db.exists(`users:${to}`)) socket.emit('msg', { ok: false, msg: '用戶不存在' })

        // 根據 states
        const states = ['不是好友', '成為好友', '需要確認', '等待確認', '拒絕', '被拒絕', '確認', '被確認']

        // 將好友關係存儲在伺服器中
        await db.hSet(`users:${from}:friends`, to, 2)
        await db.hSet(`users:${to}:friends`, to, 3)
        

        // 通知發送請求的用戶，好友已經被成功添加
        socket.emit('msg', { ok: true, msg: `已請求添加 ${to} 為好友`, system: true })

        // 如果對方也在線上，通知對方有人想添加他為好友
        io.to(await user(to, 'socketID')).emit('friendRequest', { ok: true, msg: `${from} 把您設為好友`, system: true });
    });

    socket.on('confirmFriend', async data => {
        const { to } = data
        const from = socket.user.id

        await db.hSet(`users:${from}:friends`, to, 6)
        await db.hSet(`users:${to}:friends`, to, 7)
        
        socket.emit('msg', { ok: true, msg: `已確認添加 ${to} 為好友`, system: true})
        io.to(await user(to, 'socketID')).emit('msg', { ok: true, msg: `${from} 已確認好友關係`, system: true })
    })

    socket.on('disconnect', async () => {
        // 刪除 socketID
        await db.hSet(`users:${socket.user.id}`, 'socketID', null)
    });
});

// 啟動伺服器監聽指定的埠號
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`伺服器正在監聽埠號 ${PORT}`);
});