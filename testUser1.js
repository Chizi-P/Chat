import { io } from 'socket.io-client'

const socket = io("ws://localhost:3000", {
    reconnectionDelayMax: 10000,
    auth: {
    },
    extraHeaders: {
        email: 'user1@email.com',
        password: 'user1password',
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

socket.onAny((...args) => {
    console.log(args)
})

socket.emit('friendInvitation', '01HJR4QMP3ZQPH312T7AVM3B4Z', res => {
    console.log(res)
})

// socket.emit('message', )

