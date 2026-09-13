export interface Platform {DB:any;FILES:any;ADMIN_EMAILS?:string;LOCAL_DEV?:string;DEV_EMAIL_CODE?:string;runAssist?:(prompt:string)=>Promise<string>;[key:string]:any}
