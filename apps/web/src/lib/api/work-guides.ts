export type WorkGuide = {id:string;workVariantId:string;roadUnitId:string;title:string;kind:'DOCUMENT'|'VIDEO';sourceType:'FILE'|'LINK';contentType:string|null;fileName:string|null;byteSize:number|null;url:string;createdAt:string};
export type WorkGuideInput = {workVariantId:string;roadUnitId:string;title:string;kind:'DOCUMENT'|'VIDEO';file?:File;url?:string};
