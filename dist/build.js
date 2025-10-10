"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGhostSDK = buildGhostSDK;
const algosdk_1 = require("algosdk");
const fs_1 = require("fs");
const path_1 = require("path");
const generate_client_1 = require("./generate-client");
const algokit_client_generator_1 = require("@algorandfoundation/algokit-client-generator");
const templatesBaseDir = (0, path_1.join)(__dirname, "templates");
function getTemplate(filename) {
    return (0, fs_1.readFileSync)((0, path_1.join)(templatesBaseDir, filename)).toString();
}
function unexportClient(client, name) {
    return client.replace(`export class ${name}Client`, `class ${name}Client`).replace(`export class ${name}Factory`, `class ${name}Factory`);
}
async function buildGhostSDK(appSpecPath) {
    const appSpec = await (0, algokit_client_generator_1.loadApplicationJson)(appSpecPath);
    const client = await (0, generate_client_1.generateClient)(appSpec);
    const template = getTemplate("index.ts.template");
    const methodTemplate = getTemplate("method.ts.template");
    const { name, methods } = appSpec;
    const pieces = [unexportClient(client, name)];
    pieces.push(template.replace(/\{\{ARC56_NAME\}\}/g, name));
    const methodPieces = [];
    for (const method of methods) {
        const supportsCreate = method.actions.create.includes("NoOp");
        if (!supportsCreate) {
            throw new Error(`Method ${method.name} does not support creation calls. Decorate it with \`@abimethod({ readonly: true, onCreate: 'require' })\``);
        }
        if (!method.readonly) {
            throw new Error(`Method ${method.name} is not readonly. Decorate it with \`@abimethod({ readonly: true, onCreate: 'require' })\``);
        }
        const methodName = method.name;
        const abiMethod = new algosdk_1.ABIMethod(method);
        const methodSignature = abiMethod.getSignature();
        // console.log({ methodName, methodSignature });
        const methodString = methodTemplate
            .replace(new RegExp("{{METHOD_NAME}}", "g"), methodName)
            .replace(new RegExp("{{METHOD_SIGNATURE}}", "g"), methodSignature)
            .replace(new RegExp("{{ARC56_NAME}}", "g"), name);
        methodPieces.push(methodString);
    }
    const methodString = methodPieces.join("\n\n");
    const final = pieces.join("\n").replace(new RegExp("{{METHODS}}", "g"), methodString);
    const outputFilepath = (0, path_1.join)((0, path_1.dirname)(appSpecPath), `${name}SDK.ts`);
    (0, fs_1.writeFileSync)(outputFilepath, final);
    return outputFilepath;
}
// const client = readFileSync('scripts/artifacts/GhostofavmClient.ts').toString()
// const appSpec = JSON.parse(readFileSync('scripts/artifacts/Ghostofavm.arc56.json').toString())
// const { name } = appSpec
// built += template.replace(/\{\{ARC56_NAME\}\}/g, name)
// let methodStr: string[] = []
// for (const method of appSpec.methods) {
//   const supportsCreate = method.actions.create.includes('NoOp')
//   if (!supportsCreate) {
//     throw new Error(
//       `Method ${method.name} does not support creation calls. Decorate it with \`@abimethod({ readonly: true, onCreate: 'require' })\``,
//     )
//   }
//   if (!method.readonly) {
//     throw new Error(
//       `Method ${method.name} is not readonly. Decorate it with \`@abimethod({ readonly: true, onCreate: 'require' })\``,
//     )
//   }
//   const methodName = method.name
//   const abiMethod = new ABIMethod(method)
//   const methodSignature = abiMethod.getSignature()
//   console.log({ methodName, methodSignature })
//   methodStr.push(
//     methodTemplate.replace(/\{\{\METHOD_NAME}\}/g, methodName).replace(/\{\{\METHOD_SIGNATURE}\}/g, methodSignature),
//   )
// }
// built = built.replace(/{{METHODS}}/, methodStr.join('\n'))
// writeFileSync('src/index.ts', built)
// console.log(`export class ${name}Client`)
//# sourceMappingURL=build.js.map