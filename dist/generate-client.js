"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateClient = generateClient;
const algokit_client_generator_1 = require("@algorandfoundation/algokit-client-generator");
async function generateClient(appSpec) {
    return (0, algokit_client_generator_1.writeDocumentPartsToString)((0, algokit_client_generator_1.generate)(appSpec));
}
//# sourceMappingURL=generate-client.js.map