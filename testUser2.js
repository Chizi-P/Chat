import { io } from 'socket.io-client'

const socket = io("ws://localhost:3000", {
    reconnectionDelayMax: 10000,
    auth: {
    },
    extraHeaders: {
        email: 'user2@email.com',
        password: 'user2password',
        token: '',
    }
})

socket.on("connect", () => {
    console.log('[已連接]')
})
  
socket.on("disconnect", () => {
    console.log('[已離線]')
})

socket.on('message', (from, content) => {
    console.log('[訊息]', from, ':', content)
})

socket.on('friendInvitation', from => {
    console.log('[好友邀請]', from)
})

// socket.emit('message', '01HJR4Q77M7KBCJKV851PST2J2', 'hi', res => {
//     console.log(res)
// })