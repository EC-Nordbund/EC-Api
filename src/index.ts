import { getApp } from './express'
import * as http from 'http'

http.createServer(getApp()).listen(4000)
