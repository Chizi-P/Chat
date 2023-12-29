import { Schema, Repository } from 'redis-om';
// import YAML from 'yamljs';
// const yamlSchema = YAML.load('schema.yml') as Record<string, SchemaDefinition>
const schemasArgs = {
    user: {
        name: { type: 'string' },
        email: { type: 'string' }, // unique email
        hashedPassword: { type: 'string' }, // hasded password
        avatar: { type: 'string' }, // image src url
        createAt: { type: 'date' }, // timestamp
        friends: { type: 'string[]' }, // userID[]
        groups: { type: 'string[]' }, // groupID[]
        notifications: { type: 'string[]' }, // notifID[]
        tasks: { type: 'string[]' }, // taskID[]
        tracking: { type: 'string[]' }, // taskID[] 可以用搜尋的方法取代他
        isOnline: { type: 'boolean' }, // 是否在線
        lastOnlineTime: { type: 'date' }, // date
        serverUserID: { type: 'string' }, // server 給 user 的 ID 比如 socket.io 的 socket.id
    },
    group: {
        name: { type: 'string' },
        creator: { type: 'string' }, // userID
        avatar: { type: 'string' }, // image src url
        createAt: { type: 'date' }, // timestamp
        members: { type: 'string[]' }, // userID[]
        messages: { type: 'string[]' }, // msgID[]
        isDirect: { type: 'boolean' } // 是否為兩人的一對一聊天室
        // hierarchy : {}
    },
    message: {
        from: { type: 'string' }, // userID
        to: { type: 'string' }, // groupID
        content: { type: 'string' }, // msg content | JSON
        createAt: { type: 'date' }, // timestamp
        readers: { type: 'string[]' } // userID[]
    },
    notification: {
        from: { type: 'string' }, // userID
        to: { type: 'string' }, // userID
        eventType: { type: 'string' }, // 暫時不用
        content: { type: 'string' }, // 附帶要顯示的信息
        openURL: { type: 'string' }, // url
        createAt: { type: 'date' }, // userID | system
    },
    task: {
        // memberType : { type: 'string' },   // 
        from: { type: 'string' }, // userID | groupID
        to: { type: 'string' }, // userID
        eventType: { type: 'string' }, // 
        creator: { type: 'string' }, // userID
        createAt: { type: 'date' }, // timestamp
        content: { type: 'string' }, // string | JSON
    },
};
function createSchema(schemasArgs) {
    return Object.fromEntries(Object.entries(schemasArgs).map(([schemaName, schemaDef]) => [
        schemaName,
        new Schema(schemaName, schemaDef, { dataStructure: 'HASH' })
    ]));
}
const Schemas = createSchema(schemasArgs);
function createRepositories(redisClient) {
    return Object.fromEntries(Object.entries(Schemas).map(([key, schema]) => [key, new Repository(schema, redisClient)]));
}
export { Schemas, createSchema, createRepositories, };
