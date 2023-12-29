import bcrypt from 'bcrypt'

// 單例
function Singleton<T>(Class: new (...args: any[]) => T): (...args: any[]) => T {
    let instance: T | undefined
    return (...args: any[]): T => instance || (instance = new Class(...args))
}

type onSavingFunc = (message: string | object, ...messages: string[]) => Promise<void>

class Logger {

    private onSaving       : onSavingFunc
    public  isSavingLog    : boolean = true
    public  isShowingLog   : boolean = true
    public  isLogWithTable : boolean = true

    constructor(onSaving: onSavingFunc) {
        this.onSaving = onSaving
    }

    public async log(message: string | object, ...messages: string[]): Promise<void> {
        if (this.isShowingLog) {
            // FIXME - console.table ...message
            if (typeof message === 'object' && this.isLogWithTable) console.table(message)
            else                                                    console.log(message, ...messages)
        }
        if (this.isSavingLog) {
            await this.onSaving(message, ...messages)
        }
    }
}

async function hash(data: string | Buffer, saltRounds: number = 10): Promise<string> {
    const salt = await bcrypt.genSalt(saltRounds)
    return await bcrypt.hash(data, salt)
}

type ValueOf<T> = T[keyof T]

export type { 
    ValueOf,
    onSavingFunc
}

export {
    Singleton,
    Logger,
    hash
}