import { createClient } from 'redis';

const db = createClient()
db.on('error', err => console.log('Redis Client Error', err))
db.on('connect', () => console.log('Redis client connected'))
db.on('end', () => console.log('Redis client disconnected'))
// await db.connect()

const userID = 'testuserid4'
const name = 'testname'
const email = 'testemail'
const hashedPassword = 'testhashedPassword'
const socket = { id: 'socketid' }
const roomID = '1'

const user1 = '0000'

class A {
    constructor() {
        this.db = db
        this.text = '1'
    }

    a() {
        return {
            text: '2',
            b() {
                console.log(this.text)
            }
        }
        
    }
}

const b = new A()
b.a().b.bind({text: 3})()

// const a = await db.hSet('b', {[user1]: 'somejson' })
// console.log(a)

// await db.disconnect()