"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class userGroup {
    constructor(userGroupID, bezeichnung, mutationRechte, fieldAccess) {
        this.userGroupID = userGroupID;
        this.bezeichnung = bezeichnung;
        this.mutationRechte = mutationRechte;
        this.fieldAccess = fieldAccess;
    }
    toSave() {
        return JSON.stringify(this);
    }
}
exports.userGroup = userGroup;
