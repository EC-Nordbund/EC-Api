export function validate(rules: any, data: any) {
  const errors: string[] = [];
  Object.keys(rules).forEach((key) => {
    if (Array.isArray(rules[key])) {
      errors.push(...((rules[key] as Array<any>)
        .map((rule: (v: any) => true | string) => rule(data[key]))
        .filter((v) => v !== true) as Array<string>));
    }
    else if (typeof rules[key] === 'object') {
      if (!data[key]) {
        errors.push(`Benötigte Angaben fehlen! ${key} - DEBUG`);
      }
      else {
        errors.push(...validate(rules[key], data[key]));
      }
    }
    else {
      const err = rules[key](data[key]);
      if (err !== true) {
        errors.push(err);
      }
    }
  });
  return errors;
}
