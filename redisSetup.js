import { createClient } from 'redis';

const states = ['不是好友', '成為好友', '需要確認', '等待確認', '拒絕', '被拒絕', '確認', '被確認']




const db = createClient()
await db.connect()

const added = await db.hSet('base', 'states', JSON.stringify(states))
console.log(added)

await db.disconnect()