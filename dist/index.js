"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("./express");
const http = require("http");
http.createServer(express_1.getApp(true)).listen(4000);
