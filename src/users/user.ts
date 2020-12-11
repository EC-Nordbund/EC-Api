import { userGroup } from './userGroup';
import { userGroups } from '.';

export class user {
  public userGroup: userGroup

  constructor(
    public userID: number,
    public personID: number,
    public userName: string,
    public pwdHash: string,
    public salt: string,
    public ablaufDatum: string,
    public userGroupID: number,
    public pin: string
  ) {
    this.userGroup = userGroups.filter(
      v => v.userGroupID === userGroupID
    )[0]
  }

  toSave(ohnePWD: boolean = false): string {
    if (ohnePWD) {
      return JSON.stringify(
        {
          userID: this.userID,
          personID: this.personID,
          userName: this.userName,
          ablaufDatum: this.ablaufDatum,
          userGroupID: this.userGroupID,
          pin: this.pin
        }
      )
    } else {
      return JSON.stringify(
        {
          userID: this.userID,
          personID: this.personID,
          userName: this.userName,
          pwdHash: this.pwdHash,
          salt: this.salt,
          ablaufDatum: this.ablaufDatum,
          userGroupID: this.userGroupID,
          pin: this.pin
        }
      )
    }
  }
}
export default user
