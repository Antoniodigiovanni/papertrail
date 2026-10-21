declare module 'sanitize-html' {
  export default function sanitizeHtml(source:string,options?:{allowedTags?:string[];allowedAttributes?:Record<string,string[]>;allowedSchemes?:string[];allowProtocolRelative?:boolean}):string;
}
