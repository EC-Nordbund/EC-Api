"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _1 = require(".");
class user {
    constructor(userID, personID, userName, pwdHash, salt, ablaufDatum, userGroupID, pin) {
        this.userID = userID;
        this.personID = personID;
        this.userName = userName;
        this.pwdHash = pwdHash;
        this.salt = salt;
        this.ablaufDatum = ablaufDatum;
        this.userGroupID = userGroupID;
        this.pin = pin;
        this.userGroup = _1.userGroups.filter(v => v.userGroupID === userGroupID)[0];
    }
    toSave(ohnePWD = false) {
        if (ohnePWD) {
            return JSON.stringify({
                userID: this.userID,
                personID: this.personID,
                userName: this.userName,
                ablaufDatum: this.ablaufDatum,
                userGroupID: this.userGroupID,
                pin: this.pin
            }, null, 2);
        }
        else {
            return JSON.stringify({
                userID: this.userID,
                personID: this.personID,
                userName: this.userName,
                pwdHash: this.pwdHash,
                salt: this.salt,
                ablaufDatum: this.ablaufDatum,
                userGroupID: this.userGroupID,
                pin: this.pin
            });
        }
    }
    checkAlowedFileds(args) {
        // return true
        if (args instanceof Array) {
            return this._checkAlowedFileds(args);
        }
        else {
            return this._checkAlowedFileds([args]);
        }
    }
    _checkAlowedFileds(args) {
        args.map(singleCheck => {
            return (this.userGroup.fieldAccess.filter(value => {
                if (value.field !== '*' &&
                    value.field !== singleCheck.field) {
                    return false;
                }
                if (value.table !== '*' &&
                    value.table !== singleCheck.table) {
                    return false;
                }
                return true;
            }).length > 0);
        });
        return true;
    }
}
exports.user = user;
exports.default = user;
