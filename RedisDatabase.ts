import { createClient, RedisClientType, RedisClientOptions } from 'redis'

import { Singleton, Logger } from "./util.js"

import type { RepositoriesDataType } from './schema.js'
import { createRepositories, RepositoriesType } from './schema.js'

class RedisDatabase {

    private db             : RedisClientType
    private redisOptions?  : RedisClientOptions // FIXME: use options
    public  repos          : RepositoriesType
    private logger         : Logger

    constructor(redisOptions?: RedisClientOptions) {
        this.redisOptions = redisOptions
        this.db = createClient()
        this.db.on('error',  err => this.log('Redis Client Error', err))
        this.db.on('connect', () => this.log('Redis client connected'))
        this.db.on('end',     () => this.log('Redis client disconnected'))

        this.repos = createRepositories(this.db)
        this.connect().then(() => {
            Object.entries(this.repos).forEach(([key, val]) => {
                val.createIndex().then(() => this.log(`Index of ${key} created successfully`))
            })
        })

        this.logger = new Logger(async (...messages) => {
            await this.db.lPush('logs', JSON.stringify({ log: messages.join(' '), createAt: Date.now() }))
        })
    }

    public async log(...message: Parameters<Logger['log']>): ReturnType<Logger['log']> {
        await this.logger.log(...message)
    }

    public async push(
        repoKey : keyof RepositoriesType, 
        id      : string, 
        key     : keyof RepositoriesDataType[typeof repoKey], 
        ...data : any[]
    ) {
        let obj = await this.repos[repoKey].fetch(id) as RepositoriesDataType[typeof repoKey]
        (obj[key] as typeof data).push(...data)
        return await this.repos[repoKey].save(obj)
    }

    public async remove(
        repoKey : keyof RepositoriesType, 
        id      : string, 
        key     : keyof RepositoriesDataType[typeof repoKey], 
        ...data : any[]
    ) {
        let obj = await this.repos[repoKey].fetch(id) as RepositoriesDataType[typeof repoKey]
        (obj[key] as typeof data) = (obj[key] as typeof data).filter(e => !(e in data))
        return await this.repos[repoKey].save(obj) as RepositoriesDataType[typeof repoKey]
    }

    public async existed(repo: keyof RepositoriesType, field: string, val: string) {
        return await this.repos[repo].search().where(field).eq(val).return.count() > 0
    }
        
    public async quit() {
        return await this.db.quit()
    }

    public async connect() {
        await this.db.connect()
        return this
    }

    public async disconnect() {
        await this.db.disconnect()
        return this
    }
}

export const RedisDB = Singleton(RedisDatabase)

export type {
    RedisDatabase
}