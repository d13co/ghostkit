import { ABIMethod } from "algosdk";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { generateClient } from "./generate-client";
import { loadApplicationJson } from "@algorandfoundation/algokit-client-generator";

const templatesBaseDir = join(__dirname, "templates");

function getTemplate(filename: string) {
  return readFileSync(join(templatesBaseDir, filename)).toString();
}

function unexportClient(client: string, name: string) {
  return client.replace(`export class ${name}Client`, `class ${name}Client`).replace(`export class ${name}Factory`, `class ${name}Factory`);
}

export async function buildGhostSDK(appSpecPath: string) {
  const appSpec = await loadApplicationJson(appSpecPath);
  const client = await generateClient(appSpec);

  const template = getTemplate("index.ts.template");
  const methodTemplate = getTemplate("method.ts.template");

  const { name, methods } = appSpec;
  const pieces = [unexportClient(client, name)];
  pieces.push(template.replace(/\{\{ARC56_NAME\}\}/g, name));

  const methodPieces: string[] = [];
  for (const method of methods) {
    const supportsCreate = method.actions.create.includes("NoOp");
    if (!supportsCreate) {
      throw new Error(
        `Method ${method.name} does not support creation calls. Decorate it with \`@abimethod({ readonly: true, onCreate: 'allow' })\``,
      );
    }
    if (!method.readonly) {
      throw new Error(`Method ${method.name} is not readonly. Decorate it with \`@abimethod({ readonly: true, onCreate: 'allow' })\``);
    }

    const methodName = method.name;
    const abiMethod = new ABIMethod(method);
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

  const outputFilepath = join(dirname(appSpecPath), `${name}SDK.ts`)
  writeFileSync(outputFilepath, final)

  return outputFilepath
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
