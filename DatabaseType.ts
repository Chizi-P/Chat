import jwt from 'jsonwebtoken'

import type { RepositoriesDataType } from './schema.js'
import type { RedisDatabase } from './RedisDatabase.js'

type Config = {
    privateKey: jwt.Secret
}

type UserID         = string
type GroupID        = string
type MessageID      = string
type NotificationID = string
type TaskID         = string
type FileID         = string
type User           = RepositoriesDataType['user']
type Group          = RepositoriesDataType['group']
type Message        = RepositoriesDataType['message']
type Notification   = RepositoriesDataType['notification'] & { eventType: ChatEvents }
type Task           = RepositoriesDataType['task'] & { eventType: ChatEvents }
type File           = RepositoriesDataType['file']

// FIXME
enum FileTypes {
    image = 'image',
    video = 'video',
    sound = 'sound',
}

enum MessageTypes {
    text    = 'text',
    image   = 'image',
    video   = 'video',
    sound   = 'sound',
    sticker = 'sticker',
    gif     = 'gif',
}

enum ChatEvents {
    SendMessage            = 'sendMessage',         // 發送訊息
    FriendInvitation       = 'friendInvitation',    // 好友邀請
    GroupInvitation        = 'groupInvitation',     // 群組邀請
}

enum ChatError {
    EmailAlreadyExists     = 'EmailAlreadyExists',     // 電子郵件已存在
    InvalidEmail           = 'InvalidEmail',           // 無效的電子郵件
    InvalidUsername        = 'InvalidUsername',        // 無效的用戶名
    WeakPassword           = 'WeakPassword',           // 弱密碼
    InvalidPassword        = 'InvalidPassword',        // 無效的密碼
    ServerError            = 'ServerError',            // 伺服器內部錯誤
    CaptchaError           = 'CaptchaError',           // 驗證碼錯誤
    TermsNotAccepted       = 'TermsNotAccepted',       // 用戶未接受條款
    UserNotFound           = 'UserNotFound',           // 用戶不存在
    AccountOrPasswordError = 'AccountOrPasswordError', // 帳號或密碼錯誤
    TokenValidationError   = 'TokenValidationError',   // token 驗證失敗
}

type ResultWithChatError<T extends object = {}> =
    | ({ err?: undefined } & T)
    | ({ err: ChatError | string } & Partial<T>)

type ChatRegisterEvent = Record<ChatEvents | string, {
    action? : (this: RedisDatabase, task: Task) => Promise<any>,
    finish? : (this: RedisDatabase, task: Task) => Promise<any>,
}>

export type {
    UserID,
    GroupID,
    MessageID,
    NotificationID ,
    TaskID,
    FileID,
    User,
    Group,
    Message,
    Notification,
    Task,
    File,
    ResultWithChatError, 
    Config,
    ChatRegisterEvent
}

export {
    ChatEvents,
    ChatError,
    FileTypes,
    MessageTypes
}