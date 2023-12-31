import express from 'express'
import jwt from 'jsonwebtoken'

declare module 'jsonwebtoken' {
    export interface UserJwtPayload extends jwt.JwtPayload {
        userID   : string, 
        name     : string, 
        email    : string, 
        createAt : number,
    }
}

declare module 'express-serve-static-core' {
    interface Request {
        user: {
            userID : string, 
            name   : string, 
            email  : string, 
            token  : string
        }
    }
}