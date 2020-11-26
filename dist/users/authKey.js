"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const js_sha3_1 = require("js-sha3");
class authKey {
    constructor(user) {
        this.user = user;
        this.ablaufTime = new Date();
        this.wrongCounter = 0;
        this.authToken = js_sha3_1.sha3_512('authKey_123' +
            user.pwdHash +
            user.userName +
            user.userGroup.bezeichnung +
            new Date().toISOString() +
            Math.random());
        this.extend();
    }
    extend() {
        this.ablaufTime = new Date();
        this.ablaufTime.setTime(new Date().getTime() + 1000 * 60 * 35);
    }
    reactivate(pin) {
        let tmpDate = new Date();
        if (tmpDate.getTime() - this.ablaufTime.getTime() < 3 * 60 * 60 * 1000) {
            if (pin === this.user.pin) {
                this.extend();
                return;
            }
        }
        this.wrongCounter = this.wrongCounter + 1;
        if (this.wrongCounter >= 3) {
            this.authToken = js_sha3_1.sha3_512('authKey_123' +
                this.user.pwdHash +
                this.user.userName +
                this.user.userGroup.bezeichnung +
                new Date().toISOString() +
                Math.random());
        }
        throw 'Not Reactable - Zu Spät';
    }
}
exports.authKey = authKey;
