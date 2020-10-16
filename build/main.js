"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contextTypeVar = exports.visit = exports.generateFile = exports.OneofOption = exports.EnvOption = exports.LongOption = void 0;
const ts_poet_1 = require("ts-poet");
const pbjs_1 = require("../build/pbjs");
const types_1 = require("./types");
const sequency_1 = require("sequency");
const sourceInfo_1 = require("./sourceInfo");
const utils_1 = require("./utils");
const case_1 = require("./case");
const generate_nestjs_1 = require("./generate-nestjs");
const generate_services_1 = require("./generate-services");
var FieldDescriptorProto = pbjs_1.google.protobuf.FieldDescriptorProto;
var FileDescriptorProto = pbjs_1.google.protobuf.FileDescriptorProto;
const generate_grpc_web_1 = require("./generate-grpc-web");
var LongOption;
(function (LongOption) {
    LongOption["NUMBER"] = "number";
    LongOption["LONG"] = "long";
    LongOption["STRING"] = "string";
})(LongOption = exports.LongOption || (exports.LongOption = {}));
var EnvOption;
(function (EnvOption) {
    EnvOption["NODE"] = "node";
    EnvOption["BROWSER"] = "browser";
    EnvOption["BOTH"] = "both";
})(EnvOption = exports.EnvOption || (exports.EnvOption = {}));
var OneofOption;
(function (OneofOption) {
    OneofOption["PROPERTIES"] = "properties";
    OneofOption["UNIONS"] = "unions";
})(OneofOption = exports.OneofOption || (exports.OneofOption = {}));
function generateFile(typeMap, fileDesc, parameter) {
    const options = utils_1.optionsFromParameter(parameter);
    // Google's protofiles are organized like Java, where package == the folder the file
    // is in, and file == a specific service within the package. I.e. you can have multiple
    // company/foo.proto and company/bar.proto files, where package would be 'company'.
    //
    // We'll match that stucture by setting up the module path as:
    //
    // company/foo.proto --> company/foo.ts
    // company/bar.proto --> company/bar.ts
    //
    // We'll also assume that the fileDesc.name is already the `company/foo.proto` path, with
    // the package already implicitly in it, so we won't re-append/strip/etc. it out/back in.
    const moduleName = fileDesc.name.replace('.proto', '.ts');
    let file = ts_poet_1.FileSpec.create(moduleName);
    // Indicate this file's source protobuf package for reflective use with google.protobuf.Any
    file = file.addCode(ts_poet_1.CodeBlock.empty().add(`export const protobufPackage = '%L'\n`, fileDesc.package));
    const sourceInfo = sourceInfo_1.default.fromDescriptor(fileDesc);
    // Syntax, unlike most fields, is not repeated and thus does not use an index
    const headerComment = sourceInfo.lookup(sourceInfo_1.Fields.file.syntax, undefined);
    utils_1.maybeAddComment(headerComment, (text) => (file = file.addComment(text)));
    // first make all the type declarations
    visit(fileDesc, sourceInfo, (fullName, message, sInfo) => {
        file = file.addInterface(generateInterfaceDeclaration(typeMap, fullName, message, sInfo, options));
    }, options, (fullName, enumDesc, sInfo) => {
        file = file.addCode(generateEnum(options, fullName, enumDesc, sInfo));
    });
    // If nestJs=true export [package]_PACKAGE_NAME and [service]_SERVICE_NAME const
    if (options.nestJs) {
        file = file.addCode(ts_poet_1.CodeBlock.empty().add(`export const %L = '%L'`, `${case_1.camelToSnake(fileDesc.package.replace(/\./g, '_'))}_PACKAGE_NAME`, fileDesc.package));
    }
    if (options.outputEncodeMethods || options.outputJsonMethods) {
        // then add the encoder/decoder/base instance
        visit(fileDesc, sourceInfo, (fullName, message) => {
            file = file.addProperty(generateBaseInstance(typeMap, fullName, message, options));
            let staticMethods = ts_poet_1.CodeBlock.empty().add('export const %L = ', fullName).beginHash();
            staticMethods = !options.outputEncodeMethods
                ? staticMethods
                : staticMethods
                    .addHashEntry(generateEncode(typeMap, fullName, message, options))
                    .addHashEntry(generateDecode(typeMap, fullName, message, options));
            staticMethods = !options.outputJsonMethods
                ? staticMethods
                : staticMethods
                    .addHashEntry(generateFromJson(typeMap, fullName, message, options))
                    .addHashEntry(generateFromPartial(typeMap, fullName, message, options))
                    .addHashEntry(generateToJson(typeMap, fullName, message, options));
            staticMethods = staticMethods.endHash().add(';').newLine();
            file = file.addCode(staticMethods);
        }, options);
    }
    visitServices(fileDesc, sourceInfo, (serviceDesc, sInfo) => {
        if (options.nestJs) {
            // NestJS is sufficiently different that we special case all of the client/server interfaces
            // generate nestjs grpc client interface
            file = file.addInterface(generate_nestjs_1.generateNestjsServiceClient(typeMap, fileDesc, sInfo, serviceDesc, options));
            // and the service controller interface
            file = file.addInterface(generate_nestjs_1.generateNestjsServiceController(typeMap, fileDesc, sInfo, serviceDesc, options));
            // generate nestjs grpc service controller decorator
            file = file.addFunction(generate_nestjs_1.generateNestjsGrpcServiceMethodsDecorator(serviceDesc, options));
            let serviceConstName = `${case_1.camelToSnake(serviceDesc.name)}_NAME`;
            if (!serviceDesc.name.toLowerCase().endsWith('service')) {
                serviceConstName = `${case_1.camelToSnake(serviceDesc.name)}_SERVICE_NAME`;
            }
            file = file.addCode(ts_poet_1.CodeBlock.empty().add(`export const %L = '%L';`, serviceConstName, serviceDesc.name));
        }
        else {
            // This could be twirp or grpc-web or JSON (maybe). So far all of their interaces
            // are fairly similar.
            file = file.addInterface(generate_services_1.generateService(typeMap, fileDesc, sInfo, serviceDesc, options));
            if (options.outputClientImpl === true) {
                file = file.addClass(generate_services_1.generateServiceClientImpl(typeMap, fileDesc, serviceDesc, options));
            }
            else if (options.outputClientImpl === 'grpc-web') {
                file = file.addClass(generate_grpc_web_1.generateGrpcClientImpl(typeMap, fileDesc, serviceDesc, options));
                file = file.addCode(generate_grpc_web_1.generateGrpcServiceDesc(fileDesc, serviceDesc));
                serviceDesc.method.forEach((method) => {
                    file = file.addCode(generate_grpc_web_1.generateGrpcMethodDesc(options, typeMap, serviceDesc, method));
                });
            }
        }
    });
    if (options.outputClientImpl && fileDesc.service.length > 0) {
        if (options.outputClientImpl === true) {
            file = file.addInterface(generate_services_1.generateRpcType(options));
        }
        else if (options.outputClientImpl === 'grpc-web') {
            file = generate_grpc_web_1.addGrpcWebMisc(options, file);
        }
    }
    if (options.useContext) {
        file = file.addInterface(generate_services_1.generateDataLoaderOptionsType());
        file = file.addInterface(generate_services_1.generateDataLoadersType());
    }
    let hasAnyTimestamps = false;
    visit(fileDesc, sourceInfo, (_, messageType) => {
        hasAnyTimestamps = hasAnyTimestamps || sequency_1.asSequence(messageType.field).any(types_1.isTimestamp);
    }, options);
    if (hasAnyTimestamps && (options.outputJsonMethods || options.outputEncodeMethods)) {
        file = addTimestampMethods(file, options);
    }
    const initialOutput = file.toString();
    // This `.includes(...)` is a pretty fuzzy way of detecting whether we use these utility
    // methods (to prevent outputting them if its not necessary). In theory, we should be able
    // to lean on the code generation library more to do this sort of "output only if used",
    // similar to what it does for auto-imports.
    if (initialOutput.includes('longToNumber') ||
        initialOutput.includes('numberToLong') ||
        initialOutput.includes('longToString')) {
        file = addLongUtilityMethod(file, options);
    }
    if (initialOutput.includes('bytesFromBase64') || initialOutput.includes('base64FromBytes')) {
        file = addBytesUtilityMethods(file);
    }
    if (initialOutput.includes('DeepPartial')) {
        file = addDeepPartialType(file, options);
    }
    return file;
}
exports.generateFile = generateFile;
function addLongUtilityMethod(_file, options) {
    // Regardless of which `forceLong` config option we're using, we always use
    // the `long` library to either represent or at least sanity-check 64-bit values
    const util = ts_poet_1.TypeNames.anyType('util@protobufjs/minimal');
    const configure = ts_poet_1.TypeNames.anyType('configure@protobufjs/minimal');
    let file = _file.addCode(ts_poet_1.CodeBlock.empty()
        .beginControlFlow('if (%T.Long !== %T as any)', util, 'Long*long')
        .addStatement('%T.Long = %T as any', util, 'Long*long')
        .addStatement('%T()', configure)
        .endControlFlow());
    if (options.forceLong === LongOption.LONG) {
        return file.addFunction(ts_poet_1.FunctionSpec.create('numberToLong')
            .addParameter('number', 'number')
            .addCodeBlock(ts_poet_1.CodeBlock.empty().addStatement('return %T.fromNumber(number)', 'Long*long')));
    }
    else if (options.forceLong === LongOption.STRING) {
        return file.addFunction(ts_poet_1.FunctionSpec.create('longToString')
            .addParameter('long', 'Long*long')
            .addCodeBlock(ts_poet_1.CodeBlock.empty().addStatement('return long.toString()')));
    }
    else {
        return file.addFunction(ts_poet_1.FunctionSpec.create('longToNumber').addParameter('long', 'Long*long').addCodeBlock(ts_poet_1.CodeBlock.empty()
            .beginControlFlow('if (long.gt(Number.MAX_SAFE_INTEGER))')
            // We use globalThis to avoid conflicts on protobuf types named `Error`.
            .addStatement('throw new globalThis.Error("Value is larger than Number.MAX_SAFE_INTEGER")')
            .endControlFlow()
            .addStatement('return long.toNumber()')));
    }
}
function addBytesUtilityMethods(file) {
    return file.addCode(ts_poet_1.CodeBlock.of(`interface WindowBase64 {
  atob(b64: string): string;
  btoa(bin: string): string;
}

const windowBase64 = (globalThis as unknown as WindowBase64);
const atob = windowBase64.atob || ((b64: string) => Buffer.from(b64, 'base64').toString('binary'));
const btoa = windowBase64.btoa || ((bin: string) => Buffer.from(bin, 'binary').toString('base64'));

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; ++i) {
      arr[i] = bin.charCodeAt(i);
  }
  return arr;
}

function base64FromBytes(arr: Uint8Array): string {
  const bin: string[] = [];
  for (let i = 0; i < arr.byteLength; ++i) {
    bin.push(String.fromCharCode(arr[i]));
  }
  return btoa(bin.join(''));
}`));
}
function addDeepPartialType(file, options) {
    let oneofCase = '';
    if (options.oneof === OneofOption.UNIONS) {
        oneofCase = `
  : T extends { $case: string }
  ? { [K in keyof Omit<T, '$case'>]?: DeepPartial<T[K]> } & { $case: T['$case'] }`;
    }
    // Based on the type from ts-essentials
    return file.addCode(ts_poet_1.CodeBlock.empty().add(`type Builtin = Date | Function | Uint8Array | string | number | undefined;
type DeepPartial<T> = T extends Builtin
  ? T
  : T extends Array<infer U>
  ? Array<DeepPartial<U>>
  : T extends ReadonlyArray<infer U>
  ? ReadonlyArray<DeepPartial<U>>${oneofCase}
  : T extends {}
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : Partial<T>;`));
}
function addTimestampMethods(file, options) {
    const timestampType = 'Timestamp@./google/protobuf/timestamp';
    let secondsCodeLine = 'const seconds = date.getTime() / 1_000';
    let toNumberCode = 't.seconds';
    if (options.forceLong === LongOption.LONG) {
        toNumberCode = 't.seconds.toNumber()';
        secondsCodeLine = 'const seconds = numberToLong(date.getTime() / 1_000)';
    }
    else if (options.forceLong === LongOption.STRING) {
        toNumberCode = 'Number(t.seconds)';
        secondsCodeLine = 'const seconds = (date.getTime() / 1_000).toString()';
    }
    if (options.outputJsonMethods) {
        file = file.addFunction(ts_poet_1.FunctionSpec.create('fromJsonTimestamp')
            .addParameter('o', 'any')
            .returns('Date')
            .addCodeBlock(ts_poet_1.CodeBlock.empty()
            .beginControlFlow('if (o instanceof Date)')
            .addStatement('return o')
            .nextControlFlow('else if (typeof o === "string")')
            .addStatement('return new Date(o)')
            .nextControlFlow('else')
            .addStatement('return fromTimestamp(Timestamp.fromJSON(o))')
            .endControlFlow()));
    }
    return file
        .addFunction(ts_poet_1.FunctionSpec.create('toTimestamp')
        .addParameter('date', 'Date')
        .returns(timestampType)
        .addCodeBlock(ts_poet_1.CodeBlock.empty()
        .addStatement(secondsCodeLine)
        .addStatement('const nanos = (date.getTime() %% 1_000) * 1_000_000')
        .addStatement('return { seconds, nanos }')))
        .addFunction(ts_poet_1.FunctionSpec.create('fromTimestamp')
        .addParameter('t', timestampType)
        .returns('Date')
        .addCodeBlock(ts_poet_1.CodeBlock.empty()
        .addStatement('let millis = %L * 1_000', toNumberCode)
        .addStatement('millis += t.nanos / 1_000_000')
        .addStatement('return new Date(millis)')));
}
const UNRECOGNIZED_ENUM_NAME = 'UNRECOGNIZED';
const UNRECOGNIZED_ENUM_VALUE = -1;
function generateEnum(options, fullName, enumDesc, sourceInfo) {
    let code = ts_poet_1.CodeBlock.empty();
    // Output the `enum { Foo, A = 0, B = 1 }`
    utils_1.maybeAddComment(sourceInfo, (text) => (code = code.add(`/** %L */\n`, text)));
    code = code.beginControlFlow('export enum %L', fullName);
    enumDesc.value.forEach((valueDesc, index) => {
        const info = sourceInfo.lookup(sourceInfo_1.Fields.enum.value, index);
        utils_1.maybeAddComment(info, (text) => (code = code.add(`/** ${valueDesc.name} - ${text} */\n`)));
        code = code.add('%L = %L,\n', valueDesc.name, options.stringEnums ? `"${valueDesc.name}"` : valueDesc.number.toString());
    });
    if (options.addUnrecognizedEnum)
        code = code.add('%L = %L,\n', UNRECOGNIZED_ENUM_NAME, options.stringEnums ? `"${UNRECOGNIZED_ENUM_NAME}"` : UNRECOGNIZED_ENUM_VALUE.toString());
    code = code.endControlFlow();
    if (options.outputJsonMethods) {
        code = code.add('\n');
        code = code.addFunction(generateEnumFromJson(fullName, enumDesc, options));
        code = code.add('\n');
        code = code.addFunction(generateEnumToJson(fullName, enumDesc));
    }
    return code;
}
/** Generates a function with a big switch statement to decode JSON -> our enum. */
function generateEnumFromJson(fullName, enumDesc, options) {
    let func = ts_poet_1.FunctionSpec.create(`${case_1.camelCase(fullName)}FromJSON`)
        .addModifiers(ts_poet_1.Modifier.EXPORT)
        .addParameter('object', 'any')
        .returns(fullName);
    let body = ts_poet_1.CodeBlock.empty().beginControlFlow('switch (object)');
    for (const valueDesc of enumDesc.value) {
        body = body
            .add('case %L:\n', valueDesc.number)
            .add('case %S:%>\n', valueDesc.name)
            .addStatement('return %L.%L%<', fullName, valueDesc.name);
    }
    if (options.addUnrecognizedEnum) {
        body = body
            .add('case %L:\n', UNRECOGNIZED_ENUM_VALUE)
            .add('case %S:\n', UNRECOGNIZED_ENUM_NAME)
            .add('default:%>\n')
            .addStatement('return %L.%L%<', fullName, UNRECOGNIZED_ENUM_NAME);
    }
    else {
        body = body
            .add('default:%>\n')
            .addStatement('throw new Error("Unrecognized enum value " + %L + " for enum %L")%<', 'object', fullName);
    }
    body = body.endControlFlow();
    return func.addCodeBlock(body);
}
/** Generates a function with a big switch statement to encode our enum -> JSON. */
function generateEnumToJson(fullName, enumDesc) {
    let func = ts_poet_1.FunctionSpec.create(`${case_1.camelCase(fullName)}ToJSON`)
        .addModifiers(ts_poet_1.Modifier.EXPORT)
        .addParameter('object', fullName)
        .returns('string');
    let body = ts_poet_1.CodeBlock.empty().beginControlFlow('switch (object)');
    for (const valueDesc of enumDesc.value) {
        body = body.add('case %L.%L:%>\n', fullName, valueDesc.name).addStatement('return %S%<', valueDesc.name);
    }
    body = body.add('default:%>\n').addStatement('return "UNKNOWN"%<').endControlFlow();
    return func.addCodeBlock(body);
}
// When useOptionals=true, non-scalar fields are translated into optional properties.
function isOptionalProperty(field, options) {
    return (options.useOptionals && types_1.isMessage(field) && !types_1.isRepeated(field)) || field.proto3Optional;
}
// Create the interface with properties
function generateInterfaceDeclaration(typeMap, fullName, messageDesc, sourceInfo, options) {
    let message = ts_poet_1.InterfaceSpec.create(fullName).addModifiers(ts_poet_1.Modifier.EXPORT);
    utils_1.maybeAddComment(sourceInfo, (text) => (message = message.addJavadoc(text)));
    let processedOneofs = new Set();
    messageDesc.field.forEach((fieldDesc, index) => {
        // When oneof=unions, we generate a single property with an algebraic
        // datatype (ADT) per `oneof` clause.
        if (types_1.isWithinOneOfThatShouldBeUnion(options, fieldDesc)) {
            const { oneofIndex } = fieldDesc;
            if (!processedOneofs.has(oneofIndex)) {
                processedOneofs.add(oneofIndex);
                const prop = generateOneofProperty(typeMap, messageDesc, oneofIndex, sourceInfo, options);
                message = message.addProperty(prop);
            }
            return;
        }
        let prop = ts_poet_1.PropertySpec.create(case_1.maybeSnakeToCamel(fieldDesc.name, options), types_1.toTypeName(typeMap, messageDesc, fieldDesc, options), isOptionalProperty(fieldDesc, options));
        const info = sourceInfo.lookup(sourceInfo_1.Fields.message.field, index);
        utils_1.maybeAddComment(info, (text) => (prop = prop.addJavadoc(text)));
        message = message.addProperty(prop);
    });
    return message;
}
function generateOneofProperty(typeMap, messageDesc, oneofIndex, sourceInfo, options) {
    let fields = messageDesc.field.filter((field) => {
        return types_1.isWithinOneOf(field) && field.oneofIndex === oneofIndex;
    });
    let unionType = ts_poet_1.TypeNames.unionType(...fields.map((f) => {
        let fieldName = case_1.maybeSnakeToCamel(f.name, options);
        let typeName = types_1.toTypeName(typeMap, messageDesc, f, options);
        return ts_poet_1.TypeNames.anonymousType(new ts_poet_1.Member('$case', ts_poet_1.TypeNames.typeLiteral(fieldName), false), new ts_poet_1.Member(fieldName, typeName, /* optional */ false));
    }));
    let prop = ts_poet_1.PropertySpec.create(case_1.maybeSnakeToCamel(messageDesc.oneofDecl[oneofIndex].name, options), unionType, true // optional
    );
    // Ideally we'd put the comments for each oneof field next to the anonymous
    // type we've created in the type union above, but ts-poet currently lacks
    // that ability. For now just concatenate all comments into one big one.
    let comments = [];
    const info = sourceInfo.lookup(sourceInfo_1.Fields.message.oneof_decl, oneofIndex);
    utils_1.maybeAddComment(info, (text) => comments.push(text));
    messageDesc.field.forEach((field, index) => {
        if (!types_1.isWithinOneOf(field) || field.oneofIndex !== oneofIndex) {
            return;
        }
        const info = sourceInfo.lookup(sourceInfo_1.Fields.message.field, index);
        const name = case_1.maybeSnakeToCamel(field.name, options);
        utils_1.maybeAddComment(info, (text) => comments.push(name + '\n' + text));
    });
    if (comments.length) {
        prop = prop.addJavadoc(comments.join('\n'));
    }
    return prop;
}
function generateBaseInstance(typeMap, fullName, messageDesc, options) {
    // Create a 'base' instance with default values for decode to use as a prototype
    let baseMessage = ts_poet_1.PropertySpec.create('base' + fullName, ts_poet_1.TypeNames.anyType('object')).addModifiers(ts_poet_1.Modifier.CONST);
    let initialValue = ts_poet_1.CodeBlock.empty().beginHash();
    sequency_1.asSequence(messageDesc.field)
        .filterNot(types_1.isWithinOneOf)
        .forEach((field) => {
        let val = types_1.defaultValue(typeMap, field, options);
        if (val === 'undefined' || types_1.isBytes(field)) {
            return;
        }
        initialValue = initialValue.addHashEntry(case_1.maybeSnakeToCamel(field.name, options), val);
    });
    return baseMessage.initializerBlock(initialValue.endHash());
}
function visit(proto, sourceInfo, messageFn, options, enumFn = () => { }, tsPrefix = '', protoPrefix = '') {
    const isRootFile = proto instanceof FileDescriptorProto;
    const childEnumType = isRootFile ? sourceInfo_1.Fields.file.enum_type : sourceInfo_1.Fields.message.enum_type;
    proto.enumType.forEach((enumDesc, index) => {
        // I.e. Foo_Bar.Zaz_Inner
        const protoFullName = protoPrefix + enumDesc.name;
        // I.e. FooBar_ZazInner
        const tsFullName = tsPrefix + case_1.maybeSnakeToCamel(enumDesc.name, options);
        const nestedSourceInfo = sourceInfo.open(childEnumType, index);
        enumFn(tsFullName, enumDesc, nestedSourceInfo, protoFullName);
    });
    const messages = proto instanceof FileDescriptorProto ? proto.messageType : proto.nestedType;
    const childType = isRootFile ? sourceInfo_1.Fields.file.message_type : sourceInfo_1.Fields.message.nested_type;
    messages.forEach((message, index) => {
        // I.e. Foo_Bar.Zaz_Inner
        const protoFullName = protoPrefix + message.name;
        // I.e. FooBar_ZazInner
        const tsFullName = tsPrefix + case_1.maybeSnakeToCamel(messageName(message), options);
        const nestedSourceInfo = sourceInfo.open(childType, index);
        messageFn(tsFullName, message, nestedSourceInfo, protoFullName);
        visit(message, nestedSourceInfo, messageFn, options, enumFn, tsFullName + '_', protoFullName + '.');
    });
}
exports.visit = visit;
function visitServices(proto, sourceInfo, serviceFn) {
    proto.service.forEach((serviceDesc, index) => {
        const nestedSourceInfo = sourceInfo.open(sourceInfo_1.Fields.file.service, index);
        serviceFn(serviceDesc, nestedSourceInfo);
    });
}
/** Creates a function to decode a message by loop overing the tags. */
function generateDecode(typeMap, fullName, messageDesc, options) {
    // create the basic function declaration
    let func = ts_poet_1.FunctionSpec.create('decode')
        .addParameter('input', ts_poet_1.TypeNames.unionType('Uint8Array', 'Reader@protobufjs/minimal'))
        .addParameter('length?', 'number')
        .returns(fullName);
    // add the initial end/message
    func = func
        .addStatement('const reader = input instanceof Uint8Array ? new Reader(input) : input')
        .addStatement('let end = length === undefined ? reader.len : reader.pos + length')
        .addStatement('const message = { ...base%L } as %L', fullName, fullName);
    // initialize all lists
    messageDesc.field.filter(types_1.isRepeated).forEach((field) => {
        const value = types_1.isMapType(typeMap, messageDesc, field, options) ? '{}' : '[]';
        func = func.addStatement('message.%L = %L', case_1.maybeSnakeToCamel(field.name, options), value);
    });
    // start the tag loop
    func = func
        .beginControlFlow('while (reader.pos < end)')
        .addStatement('const tag = reader.uint32()')
        .beginControlFlow('switch (tag >>> 3)');
    // add a case for each incoming field
    messageDesc.field.forEach((field) => {
        const fieldName = case_1.maybeSnakeToCamel(field.name, options);
        func = func.addCode('case %L:%>\n', field.number);
        // get a generic 'reader.doSomething' bit that is specific to the basic type
        let readSnippet;
        if (types_1.isPrimitive(field)) {
            readSnippet = ts_poet_1.CodeBlock.of('reader.%L()', types_1.toReaderCall(field));
            if (types_1.isBytes(field)) {
                if (options.env === EnvOption.NODE) {
                    readSnippet = readSnippet.add(' as Buffer');
                }
            }
            else if (types_1.basicLongWireType(field.type) !== undefined) {
                if (options.forceLong === LongOption.LONG) {
                    readSnippet = ts_poet_1.CodeBlock.of('%L as Long', readSnippet);
                }
                else if (options.forceLong === LongOption.STRING) {
                    readSnippet = ts_poet_1.CodeBlock.of('longToString(%L as Long)', readSnippet);
                }
                else {
                    readSnippet = ts_poet_1.CodeBlock.of('longToNumber(%L as Long)', readSnippet);
                }
            }
            else if (types_1.isEnum(field)) {
                readSnippet = readSnippet.add(' as any');
            }
        }
        else if (types_1.isValueType(field)) {
            readSnippet = ts_poet_1.CodeBlock.of('%T.decode(reader, reader.uint32()).value', types_1.basicTypeName(typeMap, field, options, { keepValueType: true }));
        }
        else if (types_1.isTimestamp(field)) {
            readSnippet = ts_poet_1.CodeBlock.of('fromTimestamp(%T.decode(reader, reader.uint32()))', types_1.basicTypeName(typeMap, field, options, { keepValueType: true }));
        }
        else if (types_1.isMessage(field)) {
            readSnippet = ts_poet_1.CodeBlock.of('%T.decode(reader, reader.uint32())', types_1.basicTypeName(typeMap, field, options));
        }
        else {
            throw new Error(`Unhandled field ${field}`);
        }
        // and then use the snippet to handle repeated fields if necessary
        if (types_1.isRepeated(field)) {
            if (types_1.isMapType(typeMap, messageDesc, field, options)) {
                // We need a unique const within the `cast` statement
                const entryVariableName = `entry${field.number}`;
                func = func
                    .addStatement(`const %L = %L`, entryVariableName, readSnippet)
                    .beginControlFlow('if (%L.value !== undefined)', entryVariableName)
                    .addStatement('message.%L[%L.key] = %L.value', fieldName, entryVariableName, entryVariableName)
                    .endControlFlow();
            }
            else if (types_1.packedType(field.type) === undefined) {
                func = func.addStatement(`message.%L.push(%L)`, fieldName, readSnippet);
            }
            else {
                func = func
                    .beginControlFlow('if ((tag & 7) === 2)')
                    .addStatement('const end2 = reader.uint32() + reader.pos')
                    .beginControlFlow('while (reader.pos < end2)')
                    .addStatement(`message.%L.push(%L)`, fieldName, readSnippet)
                    .endControlFlow()
                    .nextControlFlow('else')
                    .addStatement(`message.%L.push(%L)`, fieldName, readSnippet)
                    .endControlFlow();
            }
        }
        else if (types_1.isWithinOneOfThatShouldBeUnion(options, field)) {
            let oneofName = case_1.maybeSnakeToCamel(messageDesc.oneofDecl[field.oneofIndex].name, options);
            func = func.addStatement(`message.%L = {$case: '%L', %L: %L}`, oneofName, fieldName, fieldName, readSnippet);
        }
        else {
            func = func.addStatement(`message.%L = %L`, fieldName, readSnippet);
        }
        func = func.addStatement('break%<');
    });
    func = func.addCode('default:%>\n').addStatement('reader.skipType(tag & 7)').addStatement('break%<');
    // and then wrap up the switch/while/return
    func = func.endControlFlow().endControlFlow().addStatement('return message');
    return func;
}
/** Creates a function to encode a message by loop overing the tags. */
function generateEncode(typeMap, fullName, messageDesc, options) {
    // create the basic function declaration
    let func = ts_poet_1.FunctionSpec.create('encode')
        .addParameter(messageDesc.field.length > 0 ? 'message' : '_', fullName)
        .addParameter('writer', 'Writer@protobufjs/minimal', { defaultValueField: ts_poet_1.CodeBlock.of('Writer.create()') })
        .returns('Writer@protobufjs/minimal');
    // then add a case for each field
    messageDesc.field.forEach((field) => {
        const fieldName = case_1.maybeSnakeToCamel(field.name, options);
        // get a generic writer.doSomething based on the basic type
        let writeSnippet;
        if (types_1.isPrimitive(field)) {
            const tag = ((field.number << 3) | types_1.basicWireType(field.type)) >>> 0;
            writeSnippet = (place) => ts_poet_1.CodeBlock.of('writer.uint32(%L).%L(%L)', tag, types_1.toReaderCall(field), place);
        }
        else if (types_1.isTimestamp(field)) {
            const tag = ((field.number << 3) | 2) >>> 0;
            writeSnippet = (place) => ts_poet_1.CodeBlock.of('%T.encode(toTimestamp(%L), writer.uint32(%L).fork()).ldelim()', types_1.basicTypeName(typeMap, field, options, { keepValueType: true }), place, tag);
        }
        else if (types_1.isValueType(field)) {
            const tag = ((field.number << 3) | 2) >>> 0;
            writeSnippet = (place) => ts_poet_1.CodeBlock.of('%T.encode({ value: %L! }, writer.uint32(%L).fork()).ldelim()', types_1.basicTypeName(typeMap, field, options, { keepValueType: true }), place, tag);
        }
        else if (types_1.isMessage(field)) {
            const tag = ((field.number << 3) | 2) >>> 0;
            writeSnippet = (place) => ts_poet_1.CodeBlock.of('%T.encode(%L, writer.uint32(%L).fork()).ldelim()', types_1.basicTypeName(typeMap, field, options), place, tag);
        }
        else {
            throw new Error(`Unhandled field ${field}`);
        }
        if (types_1.isRepeated(field)) {
            if (types_1.isMapType(typeMap, messageDesc, field, options)) {
                func = func
                    .beginLambda('Object.entries(message.%L).forEach(([key, value]) =>', fieldName)
                    .addStatement('%L', writeSnippet('{ key: key as any, value }'))
                    .endLambda(')');
            }
            else if (types_1.packedType(field.type) === undefined) {
                func = func
                    .beginControlFlow('for (const v of message.%L)', fieldName)
                    .addStatement('%L', writeSnippet('v!'))
                    .endControlFlow();
            }
            else {
                const tag = ((field.number << 3) | 2) >>> 0;
                func = func
                    .addStatement('writer.uint32(%L).fork()', tag)
                    .beginControlFlow('for (const v of message.%L)', fieldName)
                    .addStatement('writer.%L(v)', types_1.toReaderCall(field))
                    .endControlFlow()
                    .addStatement('writer.ldelim()');
            }
        }
        else if (types_1.isWithinOneOfThatShouldBeUnion(options, field)) {
            let oneofName = case_1.maybeSnakeToCamel(messageDesc.oneofDecl[field.oneofIndex].name, options);
            func = func
                .beginControlFlow(`if (message.%L?.$case === '%L')`, oneofName, fieldName)
                .addStatement('%L', writeSnippet(`message.${oneofName}.${fieldName}`))
                .endControlFlow();
        }
        else if (types_1.isWithinOneOf(field)) {
            // Oneofs don't have a default value check b/c they need to denote which-oneof presence
            func = func
                .beginControlFlow('if (message.%L !== undefined)', fieldName)
                .addStatement('%L', writeSnippet(`message.${fieldName}`))
                .endControlFlow();
        }
        else if (types_1.isMessage(field)) {
            func = func
                .beginControlFlow('if (message.%L !== undefined && message.%L !== %L)', fieldName, fieldName, types_1.defaultValue(typeMap, field, options))
                .addStatement('%L', writeSnippet(`message.${fieldName}`))
                .endControlFlow();
        }
        else {
            func = func.addStatement('%L', writeSnippet(`message.${fieldName}`));
        }
    });
    return func.addStatement('return writer');
}
/**
 * Creates a function to decode a message from JSON.
 *
 * This is very similar to decode, we loop through looking for properties, with
 * a few special cases for https://developers.google.com/protocol-buffers/docs/proto3#json.
 * */
function generateFromJson(typeMap, fullName, messageDesc, options) {
    // create the basic function declaration
    let func = ts_poet_1.FunctionSpec.create('fromJSON')
        .addParameter(messageDesc.field.length > 0 ? 'object' : '_', 'any')
        .returns(fullName);
    // create the message
    func = func.addStatement('const message = { ...base%L } as %L', fullName, fullName);
    // initialize all lists
    messageDesc.field.filter(types_1.isRepeated).forEach((field) => {
        const value = types_1.isMapType(typeMap, messageDesc, field, options) ? '{}' : '[]';
        func = func.addStatement('message.%L = %L', case_1.maybeSnakeToCamel(field.name, options), value);
    });
    // add a check for each incoming field
    messageDesc.field.forEach((field) => {
        const fieldName = case_1.maybeSnakeToCamel(field.name, options);
        // get a generic 'reader.doSomething' bit that is specific to the basic type
        const readSnippet = (from) => {
            if (types_1.isEnum(field)) {
                const fromJson = types_1.getEnumMethod(typeMap, field.typeName, 'FromJSON');
                return ts_poet_1.CodeBlock.of('%T(%L)', fromJson, from);
            }
            else if (types_1.isPrimitive(field)) {
                // Convert primitives using the String(value)/Number(value)/bytesFromBase64(value)
                if (types_1.isBytes(field)) {
                    if (options.env === EnvOption.NODE) {
                        return ts_poet_1.CodeBlock.of('Buffer.from(bytesFromBase64(%L))', from);
                    }
                    else {
                        return ts_poet_1.CodeBlock.of('bytesFromBase64(%L)', from);
                    }
                }
                else if (types_1.isLong(field) && options.forceLong === LongOption.LONG) {
                    const cstr = case_1.capitalize(types_1.basicTypeName(typeMap, field, options, { keepValueType: true }).toString());
                    return ts_poet_1.CodeBlock.of('%L.fromString(%L)', cstr, from);
                }
                else {
                    const cstr = case_1.capitalize(types_1.basicTypeName(typeMap, field, options, { keepValueType: true }).toString());
                    return ts_poet_1.CodeBlock.of('%L(%L)', cstr, from);
                }
            }
            else if (types_1.isTimestamp(field)) {
                return ts_poet_1.CodeBlock.of('fromJsonTimestamp(%L)', from);
            }
            else if (types_1.isValueType(field)) {
                const valueType = types_1.valueTypeName(field.typeName, options);
                if (types_1.isLongValueType(field)) {
                    return ts_poet_1.CodeBlock.of('%L.fromValue(%L)', case_1.capitalize(valueType.toString()), from);
                }
                else if (types_1.isBytesValueType(field)) {
                    return ts_poet_1.CodeBlock.of('new %L(%L)', case_1.capitalize(valueType.toString()), from);
                }
                else {
                    return ts_poet_1.CodeBlock.of('%L(%L)', case_1.capitalize(valueType.toString()), from);
                }
            }
            else if (types_1.isMessage(field)) {
                if (types_1.isRepeated(field) && types_1.isMapType(typeMap, messageDesc, field, options)) {
                    const valueType = typeMap.get(field.typeName)[2].field[1];
                    if (types_1.isPrimitive(valueType)) {
                        // TODO Can we not copy/paste this from ^?
                        if (types_1.isBytes(valueType)) {
                            if (options.env === EnvOption.NODE) {
                                return ts_poet_1.CodeBlock.of('Buffer.from(bytesFromBase64(%L as string))', from);
                            }
                            else {
                                return ts_poet_1.CodeBlock.of('bytesFromBase64(%L as string)', from);
                            }
                        }
                        else if (types_1.isEnum(valueType)) {
                            return ts_poet_1.CodeBlock.of('%L as number', from);
                        }
                        else {
                            const cstr = case_1.capitalize(types_1.basicTypeName(typeMap, valueType, options).toString());
                            return ts_poet_1.CodeBlock.of('%L(%L)', cstr, from);
                        }
                    }
                    else if (types_1.isTimestamp(valueType)) {
                        return ts_poet_1.CodeBlock.of('fromJsonTimestamp(%L)', from);
                    }
                    else {
                        return ts_poet_1.CodeBlock.of('%T.fromJSON(%L)', types_1.basicTypeName(typeMap, valueType, options).toString(), from);
                    }
                }
                else {
                    return ts_poet_1.CodeBlock.of('%T.fromJSON(%L)', types_1.basicTypeName(typeMap, field, options), from);
                }
            }
            else {
                throw new Error(`Unhandled field ${field}`);
            }
        };
        // and then use the snippet to handle repeated fields if necessary
        func = func.beginControlFlow('if (object.%L !== undefined && object.%L !== null)', fieldName, fieldName);
        if (types_1.isRepeated(field)) {
            if (types_1.isMapType(typeMap, messageDesc, field, options)) {
                func = func
                    .beginLambda('Object.entries(object.%L).forEach(([key, value]) =>', fieldName)
                    .addStatement(`message.%L[%L] = %L`, fieldName, maybeCastToNumber(typeMap, messageDesc, field, 'key', options), readSnippet('value'))
                    .endLambda(')');
            }
            else {
                func = func
                    .beginControlFlow('for (const e of object.%L)', fieldName)
                    .addStatement(`message.%L.push(%L)`, fieldName, readSnippet('e'))
                    .endControlFlow();
            }
        }
        else if (types_1.isWithinOneOfThatShouldBeUnion(options, field)) {
            let oneofName = case_1.maybeSnakeToCamel(messageDesc.oneofDecl[field.oneofIndex].name, options);
            func = func.addStatement(`message.%L = {$case: '%L', %L: %L}`, oneofName, fieldName, fieldName, readSnippet(`object.${fieldName}`));
        }
        else {
            func = func.addStatement(`message.%L = %L`, fieldName, readSnippet(`object.${fieldName}`));
        }
        // set the default value (TODO Support bytes)
        if (!types_1.isRepeated(field) &&
            field.type !== FieldDescriptorProto.Type.TYPE_BYTES &&
            options.oneof !== OneofOption.UNIONS) {
            func = func.nextControlFlow('else');
            func = func.addStatement(`message.%L = %L`, fieldName, types_1.isWithinOneOf(field) ? 'undefined' : types_1.defaultValue(typeMap, field, options));
        }
        func = func.endControlFlow();
    });
    // and then wrap up the switch/while/return
    func = func.addStatement('return message');
    return func;
}
function generateToJson(typeMap, fullName, messageDesc, options) {
    // create the basic function declaration
    let func = ts_poet_1.FunctionSpec.create('toJSON')
        .addParameter(messageDesc.field.length > 0 ? 'message' : '_', fullName)
        .returns('unknown');
    func = func.addCodeBlock(ts_poet_1.CodeBlock.empty().addStatement('const obj: any = {}'));
    // then add a case for each field
    messageDesc.field.forEach((field) => {
        const fieldName = case_1.maybeSnakeToCamel(field.name, options);
        const readSnippet = (from) => {
            if (types_1.isEnum(field)) {
                const toJson = types_1.getEnumMethod(typeMap, field.typeName, 'ToJSON');
                return types_1.isWithinOneOf(field)
                    ? ts_poet_1.CodeBlock.of('%L !== undefined ? %T(%L) : undefined', from, toJson, from)
                    : ts_poet_1.CodeBlock.of('%T(%L)', toJson, from);
            }
            else if (types_1.isTimestamp(field)) {
                return ts_poet_1.CodeBlock.of('%L !== undefined ? %L.toISOString() : null', from, from);
            }
            else if (types_1.isMapType(typeMap, messageDesc, field, options)) {
                // For map types, drill-in and then admittedly re-hard-code our per-value-type logic
                const valueType = typeMap.get(field.typeName)[2].field[1];
                if (types_1.isEnum(valueType)) {
                    const toJson = types_1.getEnumMethod(typeMap, valueType.typeName, 'ToJSON');
                    return ts_poet_1.CodeBlock.of('%T(%L)', toJson, from);
                }
                else if (types_1.isBytes(valueType)) {
                    return ts_poet_1.CodeBlock.of('base64FromBytes(%L)', from);
                }
                else if (types_1.isTimestamp(valueType)) {
                    return ts_poet_1.CodeBlock.of('%L.toISOString()', from);
                }
                else if (types_1.isPrimitive(valueType)) {
                    return ts_poet_1.CodeBlock.of('%L', from);
                }
                else {
                    return ts_poet_1.CodeBlock.of('%T.toJSON(%L)', types_1.basicTypeName(typeMap, valueType, options).toString(), from);
                }
            }
            else if (types_1.isMessage(field) && !types_1.isValueType(field) && !types_1.isMapType(typeMap, messageDesc, field, options)) {
                return ts_poet_1.CodeBlock.of('%L ? %T.toJSON(%L) : %L', from, types_1.basicTypeName(typeMap, field, options, { keepValueType: true }), from, types_1.defaultValue(typeMap, field, options));
            }
            else if (types_1.isBytes(field)) {
                if (types_1.isWithinOneOf(field)) {
                    return ts_poet_1.CodeBlock.of('%L !== undefined ? base64FromBytes(%L) : undefined', from, from);
                }
                else {
                    return ts_poet_1.CodeBlock.of('base64FromBytes(%L !== undefined ? %L : %L)', from, from, types_1.defaultValue(typeMap, field, options));
                }
            }
            else if (types_1.isLong(field) && options.forceLong === LongOption.LONG) {
                return ts_poet_1.CodeBlock.of('(%L || %L).toString()', from, types_1.isWithinOneOf(field) ? 'undefined' : types_1.defaultValue(typeMap, field, options));
            }
            else {
                return ts_poet_1.CodeBlock.of('%L', from);
            }
        };
        if (types_1.isMapType(typeMap, messageDesc, field, options)) {
            // Maps might need their values transformed, i.e. bytes --> base64
            func = func
                .addStatement('obj.%L = {}', fieldName)
                .beginControlFlow('if (message.%L)', fieldName)
                .beginLambda('Object.entries(message.%L).forEach(([k, v]) =>', fieldName)
                .addStatement('obj.%L[k] = %L', fieldName, readSnippet('v'))
                .endLambda(')')
                .endControlFlow();
        }
        else if (types_1.isRepeated(field)) {
            // Arrays might need their elements transformed
            func = func
                .beginControlFlow('if (message.%L)', fieldName)
                .addStatement('obj.%L = message.%L.map(e => %L)', fieldName, fieldName, readSnippet('e'))
                .nextControlFlow('else')
                .addStatement('obj.%L = []', fieldName)
                .endControlFlow();
        }
        else if (types_1.isWithinOneOfThatShouldBeUnion(options, field)) {
            // oneofs in a union are only output as `oneof name = ...`
            let oneofName = case_1.maybeSnakeToCamel(messageDesc.oneofDecl[field.oneofIndex].name, options);
            func = func.addStatement(`message.%L?.$case === '%L' && (obj.%L = %L)`, oneofName, fieldName, fieldName, readSnippet(`message.${oneofName}?.${fieldName}`));
        }
        else {
            func = func.addStatement('message.%L !== undefined && (obj.%L = %L)', fieldName, fieldName, readSnippet(`message.${fieldName}`));
        }
    });
    return func.addStatement('return obj');
}
function generateFromPartial(typeMap, fullName, messageDesc, options) {
    // create the basic function declaration
    let func = ts_poet_1.FunctionSpec.create('fromPartial')
        .addParameter(messageDesc.field.length > 0 ? 'object' : '_', `DeepPartial<${fullName}>`)
        .returns(fullName);
    // create the message
    func = func.addStatement('const message = { ...base%L } as %L', fullName, fullName);
    // initialize all lists
    messageDesc.field.filter(types_1.isRepeated).forEach((field) => {
        const value = types_1.isMapType(typeMap, messageDesc, field, options) ? '{}' : '[]';
        func = func.addStatement('message.%L = %L', case_1.maybeSnakeToCamel(field.name, options), value);
    });
    // add a check for each incoming field
    messageDesc.field.forEach((field) => {
        const fieldName = case_1.maybeSnakeToCamel(field.name, options);
        const readSnippet = (from) => {
            if (types_1.isEnum(field) || types_1.isPrimitive(field) || types_1.isTimestamp(field) || types_1.isValueType(field)) {
                return ts_poet_1.CodeBlock.of(from);
            }
            else if (types_1.isMessage(field)) {
                if (types_1.isRepeated(field) && types_1.isMapType(typeMap, messageDesc, field, options)) {
                    const valueType = typeMap.get(field.typeName)[2].field[1];
                    if (types_1.isPrimitive(valueType)) {
                        if (types_1.isBytes(valueType)) {
                            return ts_poet_1.CodeBlock.of('%L', from);
                        }
                        else if (types_1.isEnum(valueType)) {
                            return ts_poet_1.CodeBlock.of('%L as number', from);
                        }
                        else {
                            const cstr = case_1.capitalize(types_1.basicTypeName(typeMap, valueType, options).toString());
                            return ts_poet_1.CodeBlock.of('%L(%L)', cstr, from);
                        }
                    }
                    else if (types_1.isTimestamp(valueType)) {
                        return ts_poet_1.CodeBlock.of('%L', from);
                    }
                    else {
                        return ts_poet_1.CodeBlock.of('%T.fromPartial(%L)', types_1.basicTypeName(typeMap, valueType, options).toString(), from);
                    }
                }
                else {
                    return ts_poet_1.CodeBlock.of('%T.fromPartial(%L)', types_1.basicTypeName(typeMap, field, options), from);
                }
            }
            else {
                throw new Error(`Unhandled field ${field}`);
            }
        };
        // and then use the snippet to handle repeated fields if necessary
        if (types_1.isRepeated(field)) {
            func = func.beginControlFlow('if (object.%L !== undefined && object.%L !== null)', fieldName, fieldName);
            if (types_1.isMapType(typeMap, messageDesc, field, options)) {
                func = func
                    .beginLambda('Object.entries(object.%L).forEach(([key, value]) =>', fieldName)
                    .beginControlFlow('if (value !== undefined)')
                    .addStatement(`message.%L[%L] = %L`, fieldName, maybeCastToNumber(typeMap, messageDesc, field, 'key', options), readSnippet('value'))
                    .endControlFlow()
                    .endLambda(')');
            }
            else {
                func = func
                    .beginControlFlow('for (const e of object.%L)', fieldName)
                    .addStatement(`message.%L.push(%L)`, fieldName, readSnippet('e'))
                    .endControlFlow();
            }
        }
        else if (types_1.isWithinOneOfThatShouldBeUnion(options, field)) {
            let oneofName = case_1.maybeSnakeToCamel(messageDesc.oneofDecl[field.oneofIndex].name, options);
            func = func
                .beginControlFlow(`if (object.%L?.$case === '%L' && object.%L?.%L !== undefined && object.%L?.%L !== null)`, oneofName, fieldName, oneofName, fieldName, oneofName, fieldName)
                .addStatement(`message.%L = {$case: '%L', %L: %L}`, oneofName, fieldName, fieldName, readSnippet(`object.${oneofName}.${fieldName}`));
        }
        else {
            func = func.beginControlFlow('if (object.%L !== undefined && object.%L !== null)', fieldName, fieldName);
            if ((types_1.isLong(field) || types_1.isLongValueType(field)) && options.forceLong === LongOption.LONG) {
                func = func.addStatement(`message.%L = %L as %L`, fieldName, readSnippet(`object.${fieldName}`), types_1.basicTypeName(typeMap, field, options));
            }
            else {
                func = func.addStatement(`message.%L = %L`, fieldName, readSnippet(`object.${fieldName}`));
            }
        }
        if (!types_1.isRepeated(field) && options.oneof !== OneofOption.UNIONS) {
            func = func.nextControlFlow('else');
            func = func.addStatement(`message.%L = %L`, fieldName, types_1.isWithinOneOf(field) ? 'undefined' : types_1.defaultValue(typeMap, field, options));
        }
        func = func.endControlFlow();
    });
    // and then wrap up the switch/while/return
    return func.addStatement('return message');
}
exports.contextTypeVar = ts_poet_1.TypeNames.typeVariable('Context', ts_poet_1.TypeNames.bound('DataLoaders'));
function maybeCastToNumber(typeMap, messageDesc, field, variableName, options) {
    const { keyType } = types_1.detectMapType(typeMap, messageDesc, field, options);
    if (keyType === ts_poet_1.TypeNames.STRING) {
        return variableName;
    }
    else {
        return `Number(${variableName})`;
    }
}
const builtInNames = ['Date'];
/** Potentially suffixes `Message` to names to avoid conflicts, i.e. with `Date`. */
function messageName(message) {
    const { name } = message;
    return builtInNames.includes(name) ? `${name}Message` : name;
}
