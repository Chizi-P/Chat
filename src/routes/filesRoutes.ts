import { Router } from 'express'
import path from 'path'
import { 
    uploadFile,
    getFile,
} from '../controllers/filesControllers.js'

const router = Router()

router.post('/file', uploadFile)

router.get('/file/:id', getFile)

// router.put('/file/:filePath', )
// router.delete('/file/:filePath', )

export default router