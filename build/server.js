import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { parse } from 'cookie';
import { Chat, ChatError } from './redisChatWithSchema.js';
import * as cfg from './.config.js';
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.get('/', (req, res) => {
    res.send('api');
});
const ok = (msg) => ({ ok: true, msg });
const not = (msg) => ({ ok: false, msg });
// ------------------------------- //
const chat = Chat({
    privateKey: cfg.privateKey
});
console.log('已連接db');
app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    console.table(req.body);
    // 輸入不能為空
    if (!(name && email && password))
        return res.send(not('輸入不能為空'));
    const userID = await chat.createUser(name, email, password);
    if (userID in ChatError) {
        return res.send(not(userID));
    }
    console.log('userID:', userID);
    return res.send(ok('註冊成功'));
});
// TODO - logger
io.use(async (socket, next) => {
    const cookies = parse(socket.request.headers.cookie || "");
    // console.log('cookies:', cookies)
    let token = socket.handshake.headers.token || cookies.token;
    const { email, password } = socket.handshake.headers;
    // console.table(socket.handshake.headers)
    let user;
    // login with token //
    if (token !== undefined) {
        user = await chat.login(token);
        if (user.err !== undefined)
            return next(new Error('token 驗證失敗'));
        // login with email and password //
    }
    else if (email !== undefined && password !== undefined) {
        user = await chat.login(email, password);
        if (user.err !== undefined)
            return next(new Error('帳號或密碼錯誤')); // FIXME - error 的類型
    }
    else {
        socket.disconnect(true);
        console.log('用戶沒有提供 token 或 email 和 password');
        return next(new Error('用戶沒有提供 token 或 email 和 password'));
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
    socket.data.userID = user.userID;
    socket.data.name = user.name;
    socket.data.email = user.email;
    // OPT - 儲存對應的 socket id
    await (await chat.user(user.userID)).set('serverUserID', socket.id);
    console.log('[登錄]', socket.data.userID);
    return next();
});
io.on('connection', async (socket) => {
    console.log('[已連接]', socket.data.userID);
    // 讀取離線消息
    // while (true) {
    //     const msg = await db.rPop(`${socket.data.userID}OfflineMessageQueue`)
    //     if (msg !== null) socket.emit('msg', { ok: true, msg })
    //     else break
    // }
    let notifications = await chat.checkForOfflineMessages(socket.data.userID);
    if (notifications.length > 0) {
        socket.emit('notifications', notifications);
    }
    await socket.join((await chat.user(socket.data.userID)).groups);
    // 轉發訊息
    socket.on('message', async (toGroupID, content, callback) => {
        const from = socket.data.userID;
        console.log('[傳訊息]', from, ':', content, '=>', toGroupID);
        // socket.to(toGroupID).emit('message', from, content)
        io.to(toGroupID).emit('message', from, content);
        await chat.sendMessage(from, toGroupID, content);
        // OPT to user 有 socketID 的話代表在線
        // 在線
        if (true) {
            callback(ok('已傳送'));
        }
        // 不在線
        else {
            callback({ ok: false, message: '用戶不在線' });
            // 發到離線消息隊列
        }
    });
    socket.on('friendInvitation', async (to, callback) => {
        // TODO - 判斷 to user 是否存在
        const from = socket.data.userID;
        let user = await chat.repos.user.fetch(to);
        const toSocketID = user.serverUserID;
        // if (!await db.exists(`users:${to}`)) socket.emit('msg', { ok: false, msg: '用戶不存在' })
        // // 根據 states
        // const states = ['不是好友', '成為好友', '需要確認', '等待確認', '拒絕', '被拒絕', '確認', '被確認']
        // 將好友關係存儲在伺服器中
        // await db.hSet(`users:${from}:friends`, to, 2)
        // await db.hSet(`users:${to}:friends`, to, 3)
        // 通知發送請求的用戶，好友已經被成功添加
        // socket.emit('msg', { ok: true, msg: `已請求添加 ${to} 為好友`, system: true })
        await chat.FriendInvitation(from, to);
        // io.to(to).emit('friendInvitation', from)
        socket.to(toSocketID).emit('friendInvitation', from);
        // 如果對方也在線上，通知對方有人想添加他為好友
        // io.to(await user(to, 'socketID')).emit('friendRequest', { ok: true, msg: `${from} 把您設為好友`, system: true })
        callback(ok('已發送好友邀請'));
    });
    socket.on('groupInvitation', async (groupID, invitedMembers) => {
        const inviter = socket.data.userID;
        await chat.groupInvitation(inviter, groupID, invitedMembers);
    });
    socket.on('confirm', async (taskID) => {
        await chat.finishTask(taskID);
    });
    socket.on('disconnect', async () => {
        // 刪除 socketID
        await (await chat.user(socket.data.userID)).set('isOnline', false);
        await (await chat.user(socket.data.userID)).set('serverUserID', '');
        console.log('[已離線]', socket.data.userID);
    });
});
// 啟動伺服器監聽指定的埠號
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`伺服器正在監聽埠號 ${PORT}`);
});
