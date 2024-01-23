import { createClient } from 'redis'
import fs from 'fs'
import path from 'path'
import config from './config.js'

async function reset() {
    const db = createClient()
    await db.connect()

    const delPatterns = [
        'file:*',
        'message:*',
        'notification:*',
        'task:*',
    ]

    for (const pattern of delPatterns) {
        const keys = await db.keys(pattern)
        keys.length && await db.del(keys)
    }
    
    const multi = db.multi()
    
    const users = await db.keys('user:*')
    const groups = await db.keys('group:*')
    
    users.forEach(user => multi.hDel(user, 'notifications'))
    groups.forEach(group => multi.hDel(group, 'messages'))
    
    await multi.exec()

    await db.disconnect()
    
    fs.rmSync(path.join(process.cwd(), config.uploadsFolder), { recursive: true, force: true })
    fs.mkdirSync(path.join(process.cwd(), config.uploadsFolder))
}

console.log('reset...')
reset()
    .then(() => console.log('done!'))
    .catch(console.warn)
