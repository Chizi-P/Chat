import { createClient } from 'redis';

const db = createClient()
db.on('error', err => console.log('Redis Client Error', err))
db.on('connect', () => console.log('Redis client connected'))
db.on('end', () => console.log('Redis client disconnected'))
await db.connect()

const name = 'testname'
const email = 'testemail'
const hashedPassword = 'testhashedPassword'
const socket = { id: 'socketid' }
const roomID = '1'

await db.hSet(`rooms:${roomID}:info:hi`, { name: name, createAt: Date.now(), creator: 'testcreator', members: JSON.stringify({'a': 'c', 'b': 1})})

await db.disconnect()