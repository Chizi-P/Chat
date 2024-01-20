import { Message, MessageTypes } from "./DatabaseType.js"

export interface ClientToServerEvents {
    message          : (toGroupID: string, type: MessageTypes, content: string, callback?: CallableFunction) => void
    friendInvitation : (to: string, callback?: CallableFunction) => void
    groupInvitation  : (groupID: string, invitedMembers: string | string[]) => void
    confirm          : (taskID: string) => void
}

export interface ServerToClientEvents {
    notifications    : (notifications: any) => void
    message          : (message: Message) => void
    friendInvitation : (from: string) => void
}

export interface InterServerEvents {
    ping: () => void
}

export interface SocketData {
    userID  : string
    name    : string
    email   : string
}
