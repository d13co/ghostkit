import {
  writeDocumentPartsToString,
  generate,
} from "@algorandfoundation/algokit-client-generator";
import { Arc56Contract } from "@algorandfoundation/algokit-utils/types/app-arc56";

export async function generateClient(appSpec: Arc56Contract) {
  return writeDocumentPartsToString(generate(appSpec));
}
