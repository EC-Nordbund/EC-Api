export function minifySql() {
  return {
    name: 'sql-minify',
    transform(code) {
      let changed = false;
      let nCode = code;
      const reg = /sql`([\s0-9a-zA-Z'"_()$[\].{}=*,><;+-]*)`/g;

      let n;
      do {
        n = reg.exec(code);

        if (n) {
          let sql = n[1];
          let sql2 = '';

          while (sql2.length !== sql.length) {
            sql2 = sql;
            sql = sql.split('\n').join(' ').split('  ').join(' ').trim();
          }

          changed = true;
          nCode = nCode.replace(n[1], sql);
        }
      } while (n);

      if (changed) {
        return nCode;
      }
    }
  };
}
