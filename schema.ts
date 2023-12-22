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
        email          : { type: 'string'},
        hashedPassword : { type: 'string' },
        avatar         : { type: 'string' },
        createAt       : { type: 'date' },
        groups         : { type: 'string[]' },
        notifications  : { type: 'string[]' }
    },
    group: {
        name     : { type: 'string' },
        creator  : { type: 'string' },
        createAt : { type: 'date' },
        messages : { type: 'string[]' },
    },
    message: {
        from     : { type: 'string' },
        to       : { type: 'string' },
        msg      : { type: 'string' },
        createAt : { type: 'date' },
    },

    notification: {
        from     : { type: 'string' },
        to       : { type: 'string[]' },
        event    : { type: 'string' },
        msgID    : { type: 'string' },
        createAt : { type: 'date' },
    },
    task: {
        memberType : { type: 'string' },
        from       : { type: 'string' },
        to         : { type: 'string[]' },
        event      : { type: 'string' },
        creator    : { type: 'string' },
        createAt   : { type: 'date' },
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
    }
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