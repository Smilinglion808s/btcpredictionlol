import {createOwnerProjection,ownerEvidenceReader,type EvidenceAdapter} from './owner-evidence';
import {createWalletSelectionController,type WalletSelectionController} from './wallet-selection-controller';
import {getWalletStandardRegistry,type WalletStandardRegistry} from './wallet-standard-discovery';
export interface OwnedEvidenceAdapter extends EvidenceAdapter { close():void; }
/** Invoke from the panel's mount-time factory, never at module evaluation or SSR. */
export function createOwnerBoundWalletController(options:{
 createOwnerAdapter:()=>OwnedEvidenceAdapter;
 registry?:WalletStandardRegistry|(()=>WalletStandardRegistry);
 nowMs?:()=>number;
 connectionTimeoutMs?:number;
}):WalletSelectionController {
 const adapter=options.createOwnerAdapter();
 let controller:WalletSelectionController;
 try{
  const owner=createOwnerProjection(ownerEvidenceReader(adapter),{nowMs:options.nowMs});
  controller=createWalletSelectionController({owner,registry:options.registry??getWalletStandardRegistry,connectionTimeoutMs:options.connectionTimeoutMs});
 }catch{try{adapter.close();}catch{/* No secret error details. */}throw new Error('WALLET_SETUP_UNAVAILABLE');}
 let closed=false;
 return Object.freeze({...controller,close(){if(closed)return;closed=true;try{controller.close();}finally{adapter.close();}}});
}
