
### ░ 技術棧
- Typescript
- Node.js
- Express
- Socket io
- Redis
- Docker-compose
- RESTful API

```
之後可能會用到
- MySQL
- K8S
```

---

### ░ HTTP API

> `/api/v1` 的所有 API 都需要通過驗證 Authorization Token

#### 用戶
| method   | path                 | description   |
|----------|----------------------|---------------|
| `POST`   | `/api/v1/login`      | 用戶登入
| `POST`   | `/api/v1/user`       | 用戶註冊
| `GET`    | `/api/v1/user`       | 獲取驗證用戶資料
| `GET`    | `/api/v1/user/:id?`  | 獲取指定用戶資料
| `PUT`    | `/api/v1/user`       | 更新驗證用戶資料
| `PUT`    | `/api/v1/user/:id?`  | 更新指定用戶資料
| `DELETE` | `/api/v1/user`       | 刪除驗證用戶
| `DELETE` | `/api/v1/user/:id?`  | 刪除指定用戶

#### 群組
| method   | path                 | description   |
|----------|----------------------|---------------|
| `POST`   | `/api/v1/group`      | 創建群組
| `GET`    | `/api/v1/group/:id?` | 獲取指定群組資料
| `PUT`    | `/api/v1/group/:id?` | 更新指定群組資料
| `DELETE` | `/api/v1/group/:id?` | 刪除指定群組

#### 訊息
| method   | path                   | description   |
|----------|------------------------|---------------|
| `POST`   | `/api/v1/message`      | 創建訊息
| `GET`    | `/api/v1/message/:id?` | 獲取指定訊息資料
| `PUT`    | `/api/v1/message/:id?` | 更新指定訊息資料
| `DELETE` | `/api/v1/message/:id?` | 刪除指定訊息

#### 任務
| method   | path                | description   |
|----------|---------------------|---------------|
| `POST`   | `/api/v1/task`      | 創建任務
| `GET`    | `/api/v1/task/:id?` | 獲取指定任務資料
| `PUT`    | `/api/v1/task/:id?` | 更新指定任務資料
| `DELETE` | `/api/v1/task/:id?` | 刪除指定任務

#### 文件
| method   | path               | description   |
|----------|--------------------|---------------|
| `POST`   | `/api/v1/file`     | 上傳文件
| `GET`    | `/api/v1/file/:id` | 獲取指定文件
<!-- | `PUT`    | `/api/v1/file/:id` | 更新指定文件 -->
<!-- | `DELETE` | `/api/v1/file/:id` | 刪除指定文件 -->

---

### ░ Socket

#### Client To Server Events：
`message: (toGroupID: string, type: MessageTypes, content: string, callback?: CallableFunction) => void` 傳送訊息

#### Server To Client Events：
`message: (message: Message) => void` 轉發訊息
