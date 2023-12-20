import { Schema, Repository } from 'redis-om'

// TODO: redis client
const redis = 'client'

const userSchema = new Schema('user', {
    name: { type: 'string' },
    email: { type: 'string' },
    hashedPassword: { type: 'string' },
    avatar: { type: 'string' },
}, {
    dataStructure: 'HASH'
})

const groupSchema = new Schema('group', {
    name: { type: 'string' },
    creator: { type: 'string' }
}, {
    dataStructure: 'HASH'
})

const messageSchema = new Schema('message', {
    from: { type: 'string' },
    to: { type: 'string[]' },
    msg: { type: 'string' },
}, {
    dataStructure: 'HASH'
})

const userRepository = new Repository(userSchema, redis)
const groupRepository = new Repository(groupSchema, redis)
const messageRepository = new Repository(messageSchema, redis)

let user = {
    name: 'name',
    email: 'email',
    hashedPassword: 'hashedPassword',
    avatar: '/'
}

user = await userRepository.save(user)