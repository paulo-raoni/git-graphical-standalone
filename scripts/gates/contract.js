import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import ts from 'typescript';

import { repositoryRoot, report } from './tree.js';

/**
 * A committed snapshot of every shape `src/contracts/` exports, and a check that
 * the shapes still match it.
 *
 * `src/contracts/` is the one thing three lanes of wave 3 share, and `AGENTS.md`
 * §5 is built on the assumption that it does not move under them. Changing a
 * contract must stay possible; changing one **silently** must not, and nothing
 * else in the pipeline notices a field quietly renamed, widened or dropped —
 * the type projects only notice once something downstream reads it, which may be
 * a lane away.
 *
 * The snapshot is produced **from the source, by the compiler**, never by hand:
 * it asks the type checker what each export resolves to, so it records the
 * shapes as a consumer sees them rather than as the file happens to be spelled.
 * A comment, a reordering or a rewritten doc block does not move it; a renamed
 * field does.
 *
 * `node scripts/gates/contract.js --record` rewrites it. That is the only way it
 * changes, and it changes inside a diff the reviewer reads.
 */

const SNAPSHOT = join(repositoryRoot, 'test', 'contract', 'shapes.snapshot.txt');
const ENTRY = join(repositoryRoot, 'src', 'contracts', 'index.ts');
// `InTypeAlias` stops the printer answering "what is this type?" with the name
// of the alias being printed, which would record every alias as itself.
const FORMAT = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias;

/** The type parameters a generic contract declares, as they are written. */
function parametersOf(symbol) {
  const declared = symbol.declarations?.[0]?.typeParameters;
  if (declared === undefined || declared.length === 0) {
    return '';
  }
  return `<${declared.map((parameter) => parameter.name.text).join(', ')}>`;
}

function programOf(configPath) {
  const file = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(file.config, ts.sys, dirname(configPath));
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
}

const program = programOf(join(repositoryRoot, 'tsconfig.inner.json'));
const checker = program.getTypeChecker();

function resolved(symbol) {
  return (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol);
}

function isReadonly(property) {
  return (property.declarations ?? []).some(
    (declaration) =>
      (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Readonly) !== 0 ||
      ts.isIndexSignatureDeclaration(declaration),
  );
}

/** One line per member, sorted, so a reordering of the source is not a change. */
function membersOf(type, place) {
  return checker
    .getPropertiesOfType(type)
    .map((property) => {
      const at = property.valueDeclaration ?? property.declarations?.[0] ?? place;
      const memberType = checker.getTypeOfSymbolAtLocation(property, at);
      const modifier = isReadonly(property) ? 'readonly ' : '';
      const optional = (property.flags & ts.SymbolFlags.Optional) === 0 ? '' : '?';
      return `    ${modifier}${property.getName()}${optional}: ${checker.typeToString(memberType, at, FORMAT)}`;
    })
    .sort();
}

/**
 * An interface is written out member by member; anything else is written as the
 * checker spells it.
 *
 * The distinction matters. Asking for the properties of a union collapses it to
 * the members its arms have in common — `Result` would be recorded as
 * `{ readonly ok: boolean }`, which is the discriminated union with its
 * discrimination filed off — and asking for the properties of a string union
 * returns every method of `String`.
 */
function describeType(name, symbol, place) {
  const declared = checker.getDeclaredTypeOfSymbol(symbol);
  if ((symbol.flags & ts.SymbolFlags.Interface) !== 0) {
    return [`interface ${name}${parametersOf(symbol)} {`, ...membersOf(declared, place), '}'];
  }
  return [`type ${name}${parametersOf(symbol)} = ${checker.typeToString(declared, place, FORMAT)}`];
}

function describeValue(name, symbol, place) {
  const at = symbol.valueDeclaration ?? symbol.declarations?.[0] ?? place;
  return [
    `value ${name}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, at), at, FORMAT)}`,
  ];
}

function describe(name, symbol, place) {
  const lines = [];
  const isType = (symbol.flags & (ts.SymbolFlags.Type | ts.SymbolFlags.TypeAlias)) !== 0;
  const isValue = (symbol.flags & ts.SymbolFlags.Value) !== 0;
  if (isType) {
    lines.push(...describeType(name, symbol, place));
  }
  if (isValue) {
    lines.push(...describeValue(name, symbol, place));
  }
  return lines.length === 0 ? [`unknown ${name}`] : lines;
}

function snapshot() {
  const entry = program.getSourceFile(ENTRY);
  if (entry === undefined) {
    throw new Error(`the contract index ${ENTRY} is not in the inner TypeScript project`);
  }
  const moduleSymbol = checker.getSymbolAtLocation(entry);
  if (moduleSymbol === undefined) {
    throw new Error('the contract index exports nothing, which cannot be right');
  }
  const lines = ['# The shapes src/contracts/ exports, as the type checker resolves them.', ''];
  for (const exported of checker.getExportsOfModule(moduleSymbol).sort(byName)) {
    lines.push(...describe(exported.getName(), resolved(exported), entry), '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function byName(left, right) {
  return left.getName() < right.getName() ? -1 : 1;
}

const current = snapshot();

if (process.argv.includes('--record')) {
  mkdirSync(dirname(SNAPSHOT), { recursive: true });
  writeFileSync(SNAPSHOT, current);
  process.stdout.write(`contract: recorded ${String(current.split('\n').length)} lines\n`);
} else if (!existsSync(SNAPSHOT)) {
  report('contract', [`no snapshot at ${SNAPSHOT}: record one with --record`]);
} else {
  const committed = readFileSync(SNAPSHOT, 'utf8');
  const findings =
    committed === current
      ? []
      : [
          'the shapes exported by src/contracts/ differ from the committed snapshot',
          'if the change is intended, re-record it with `node scripts/gates/contract.js --record`',
          'and commit the snapshot alongside the contract, so the change is visible in review',
        ];
  report('contract', findings);
}
