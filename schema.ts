import { RedisClientType } from 'redis'
import { Schema, Repository } from 'redis-om'
import type { 
    SchemaDefinition,
    BooleanFieldDefinition, 
    DateFieldDefinition,
    NumberFieldDefinition,
    NumberArrayFieldDefinition,
    PointFieldDefinition,
    StringFieldDefinition,
    StringArrayFieldDefinition,
    TextFieldDefinition,
    Entity,
} from 'redis-om'

// import YAML from 'yamljs';
// const yamlSchema = YAML.load('schema.yml') as Record<string, SchemaDefinition>

const schemasArgs = {
    user: {
        name           : { type: 'string' },
        email          : { type: 'string'},    // unique email
        hashedPassword : { type: 'string' },   // hasded password
        avatar         : { type: 'string' },   // image src url
        createAt       : { type: 'date' },     // timestamp
        friends        : { type: 'string[]' }, // userID[]
        groups         : { type: 'string[]' }, // groupID[]
        notifications  : { type: 'string[]' }, // notifID[]
        tasks          : { type: 'string[]' }, // taskID[]
        tracking       : { type: 'string[]' }, // taskID[] 可以用搜尋的方法取代他
        isOnline       : { type: 'boolean' },  // 是否在線
        lastOnlineTime : { type: 'date' },     // date
    },
    group: {
        name      : { type: 'string' },
        creator   : { type: 'string' },   // userID
        avatar    : { type: 'string' },   // image src url
        createAt  : { type: 'date' },     // timestamp
        members   : { type: 'string[]' }, // userID[]
        messages  : { type: 'string[]' }, // msgID[]
        isDirect  : { type: 'boolean'}    // 是否為兩人的一對一聊天室
        // hierarchy : {}
    },
    message: {
        from     : { type: 'string' },   // userID
        to       : { type: 'string' },   // groupID
        content  : { type: 'string' },   // msg content | JSON
        createAt : { type: 'date' },     // timestamp
        readers  : { type: 'string[]' }  // userID[]
    },
    notification: {
        from      : { type: 'string' },   // userID
        to        : { type: 'string' },   // userID
        eventType : { type: 'string' },   // 暫時不用
        content   : { type: 'string' },   // 附帶要顯示的信息
        openURL   : { type: 'string' },   // url
        createAt  : { type: 'date' },     // userID | system
    },
    task: {
        // memberType : { type: 'string' },   // 
        from       : { type: 'string' },   // userID | groupID
        to         : { type: 'string' }, // userID
        eventType  : { type: 'string' },   // 
        creator    : { type: 'string' },   // userID
        createAt   : { type: 'date' },     // timestamp
        content    : { type: 'string' },   // string | JSON
    },
} as const

type ExtractType<T> = 
    T extends BooleanFieldDefinition     ? boolean          :
    T extends DateFieldDefinition        ? Date             :
    T extends NumberFieldDefinition      ? number           :
    T extends NumberArrayFieldDefinition ? number[]         :
    T extends PointFieldDefinition       ? [number, number] :
    T extends StringFieldDefinition      ? string           :
    T extends StringArrayFieldDefinition ? string[]         :
    T extends TextFieldDefinition        ? string           :
    unknown

type GeneratedTypes<T extends Record<string, SchemaDefinition>> = {
    [Key in keyof T]: {
        [Field in keyof T[Key]]: ExtractType<T[Key][Field]>
    } & Partial<Entity> // FIXME: & Partial<Entity>
}

type RepositoriesDataType = GeneratedTypes<typeof schemasArgs>

type SchemasType<T> = Record<keyof T, Schema>

function createSchema<T>(schemasArgs: T): SchemasType<T> {
    return Object.fromEntries(
        Object.entries(schemasArgs as Record<keyof T, SchemaDefinition>).map(([schemaName, schemaDef]) => [
            schemaName, 
            new Schema(schemaName, schemaDef as SchemaDefinition, {dataStructure: 'HASH'})
        ])
    ) as SchemasType<T>
}

const Schemas = createSchema(schemasArgs)

type RepositoriesType = Record<keyof typeof Schemas, Repository>

function createRepositories(redisClient: RedisClientType): RepositoriesType {
    return Object.fromEntries(
        Object.entries(Schemas).map(([key, schema]) => [key, new Repository(schema, redisClient)])
    ) as RepositoriesType
}

export type { 
    SchemasType,
    RepositoriesType,
    RepositoriesDataType
}

export {
    Schemas,
    createSchema,
    createRepositories,
}