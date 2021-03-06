/*
  Copyright 2018 Santeri Hiltunen

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import * as _ from "lodash";
import { dissoc } from "./object-utils";
import OpenApiDocument, {
  ReferenceObject,
  SchemaObject,
} from "./OpenApiDocument";

const isReferenceObject = <T>(x: T | ReferenceObject): x is ReferenceObject =>
  (x as ReferenceObject).$ref !== undefined;

export const resolveReference = <T>(
  document: OpenApiDocument,
  object: T | ReferenceObject
): T => {
  if (isReferenceObject(object)) {
    if (!object.$ref.startsWith("#/components/")) {
      throw new Error(`Unsupported $ref=${object.$ref}`);
    }
    const path = _.drop(object.$ref.split("/"), 1);
    const resolvedObject = _.get(document, path);
    if (resolvedObject === undefined) {
      throw new Error(`Object not found with $ref=${object.$ref}`);
    }
    return resolvedObject;
  }
  return object;
};

const arrayFields = ["allOf", "anyOf", "oneOf"];
const schemaFields = ["items", "not", "additionalProperties"];

export const walkSchema = (
  originalSchema: SchemaObject,
  mapper: (x: SchemaObject) => SchemaObject
): SchemaObject => {
  let schema = mapper(originalSchema);
  const walk = (s: SchemaObject) => walkSchema(s, mapper);

  if (schema.properties !== undefined) {
    schema = { ...schema, properties: _.mapValues(schema.properties, walk) };
  }

  arrayFields.filter(f => f in schema).forEach(f => {
    schema = { ...schema, [f]: (schema as any)[f].map(walk) };
  });

  schemaFields.filter(f => f in schema).forEach(f => {
    const nestedSchema = (schema as any)[f];
    if (f === "additionalProperties" && typeof nestedSchema === "boolean") {
      return;
    }
    schema = { ...schema, [f]: walk(nestedSchema) };
  });

  return schema;
};

export const mapOasSchemaToJsonSchema = (
  originalSchema: SchemaObject,
  document: OpenApiDocument
) => {
  const mapOasFieldsToJsonSchemaFields = (s: SchemaObject) => {
    let schema = resolveReference(document, s);
    if (Array.isArray(schema.type)) {
      throw new TypeError("Type field in schema must not be an array");
    }
    if (Array.isArray(schema.items)) {
      throw new TypeError("Items field in schema must not be an array");
    }

    // Need to figure out how to handle the case when nullable is false and
    // there's no type specified. The OAS spec isn't explicit about that corner
    // case. Setting type to an array with all the primitive types except null
    // is one option but doesn't seem right. Do nothing for now.
    if (schema.nullable === true && typeof schema.type === "string") {
      schema = { ...schema, type: [schema.type, "null"] } as any;
    }
    schema = dissoc(schema, "nullable");

    return schema;
  };
  const jsonSchema = walkSchema(originalSchema, mapOasFieldsToJsonSchemaFields);
  (jsonSchema as any).$schema = "http://json-schema.org/draft-04/schema#";
  return jsonSchema;
};
