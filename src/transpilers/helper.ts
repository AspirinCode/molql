/*
 * Copyright (c) 2017 MolQL contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import * as P from 'parsimmon'

import { KeywordDict, PropertyDict } from './types'
import B from '../molql/builder'
import Expression from '../mini-lisp/expression'

export function escapeRegExp(s: String){
  return String(s).replace(/[\\^$*+?.()|[\]{}]/g, '\\$&')
}

// Takes a parser for the prefix operator, and a parser for the base thing being
// parsed, and parses as many occurrences as possible of the prefix operator.
// Note that the parser is created using `P.lazy` because it's recursive. It's
// valid for there to be zero occurrences of the prefix operator.
export function prefix(opParser: P.Parser<any>, nextParser: P.Parser<any>, mapFn: any) {
  let parser: P.Parser<any> = P.lazy(() => {
    return P.seq(opParser, parser)
      .map(x => mapFn(...x))
      .or(nextParser)
  })
  return parser
}

// Ideally this function would be just like `PREFIX` but reordered like
// `P.seq(parser, opParser).or(nextParser)`, but that doesn't work. The
// reason for that is that Parsimmon will get stuck in infinite recursion, since
// the very first rule. Inside `parser` is to match parser again. Alternatively,
// you might think to try `nextParser.or(P.seq(parser, opParser))`, but
// that won't work either because in a call to `.or` (aka `P.alt`), Parsimmon
// takes the first possible match, even if subsequent matches are longer, so the
// parser will never actually look far enough ahead to see the postfix
// operators.
export function postfix(opParser: P.Parser<any>, nextParser: P.Parser<any>, mapFn: any) {
  // Because we can't use recursion like stated above, we just match a flat list
  // of as many occurrences of the postfix operator as possible, then use
  // `.reduce` to manually nest the list.
  //
  // Example:
  //
  // INPUT  :: "4!!!"
  // PARSE  :: [4, "factorial", "factorial", "factorial"]
  // REDUCE :: ["factorial", ["factorial", ["factorial", 4]]]
  return P.seqMap(
    nextParser,
    opParser.many(),
    (x, suffixes) =>
      suffixes.reduce((acc, x) => {
        return mapFn(x, acc)
      }, x)
  )
}

// Takes a parser for all the operators at this precedence level, and a parser
// that parsers everything at the next precedence level, and returns a parser
// that parses as many binary operations as possible, associating them to the
// right. (e.g. 1^2^3 is 1^(2^3) not (1^2)^3)
export function binaryRight(opParser: P.Parser<any>, nextParser: P.Parser<any>) {
  let parser: P.Parser<any> = P.lazy(() =>
    nextParser.chain(next =>
      P.seq(
        opParser,
        P.of(next),
        parser
      ).or(P.of(next))
    )
  )
  return parser
}

// Takes a parser for all the operators at this precedence level, and a parser
// that parsers everything at the next precedence level, and returns a parser
// that parses as many binary operations as possible, associating them to the
// left. (e.g. 1-2-3 is (1-2)-3 not 1-(2-3))
export function binaryLeft(opParser: P.Parser<any>, nextParser: P.Parser<any>, mapFn: any) {
  // We run into a similar problem as with the `POSTFIX` parser above where we
  // can't recurse in the direction we want, so we have to resort to parsing an
  // entire list of operator chunks and then using `.reduce` to manually nest
  // them again.
  //
  // Example:
  //
  // INPUT  :: "1+2+3"
  // PARSE  :: [1, ["+", 2], ["+", 3]]
  // REDUCE :: ["+", ["+", 1, 2], 3]
  return P.seqMap(
    nextParser,
    P.seq(opParser, nextParser).many(),
    (first, rest) => {
      return rest.reduce((acc, ch) => {
        let [op, another] = ch;
        return mapFn(op, acc, another)
      }, first)
    }
  )
}

/**
 * combine operators of decreasing binding strength
 */
export function combineOperators (opList: any[], rule: P.Parser<any>) {
  const x = opList.reduce(
    (acc, level) => {
      const map = level.isUnsupported ? makeError(`operator '${level.name}' not supported`) : level.map
      return level.type(level.rule, acc, map)
    },
    rule
  )
  return x
}

export function infixOp (re: RegExp, group: number = 0) {
  return P.whitespace.then(P.regex(re, group).skip(P.whitespace))
}

export function prefixOp (re: RegExp, group: number = 0) {
  return P.regex(re, group).skip(P.whitespace)
}

export function postfixOp (re: RegExp, group: number = 0) {
  return P.whitespace.then(P.regex(re, group))
}

export function ofOp (name: string, short?: string) {
  const op = short ? `${name}|${escapeRegExp(short)}` : name
  const re = RegExp(`(${op})\\s+([-+]?[0-9]*\\.?[0-9]+)\\s+OF`, 'i')
  return infixOp(re, 2).map(parseFloat)
}

export function makeError (msg: string) {
  return function() {
    throw new Error(msg)
  }
}

export function andExpr (selections: any[]) {
  if (selections.length === 1){
    return selections[0]
  }else if (selections.length > 1) {
    return B.core.logic.and(selections)
  }else {
    return undefined
  }
}

export function testExpr (property: any, args: any) {
  if (args && args.op !== undefined && args.val !== undefined) {
    const opArgs = [ property, args.val ]
    switch (args.op) {
      case '=': return B.core.rel.eq(opArgs)
      case '!=': return B.core.rel.neq(opArgs)
      case '>': return B.core.rel.gr(opArgs)
      case '<': return B.core.rel.lt(opArgs)
      case '>=': return B.core.rel.gre(opArgs)
      case '<=': return B.core.rel.lte(opArgs)
      default: throw new Error(`operator '${args.op}' not supported`);
    }
  } else if (args && args.min !== undefined && args.max !== undefined) {
    return B.core.rel.inRange([ property, args.min, args.max ])
  } else if (!Array.isArray(args)) {
    return B.core.rel.eq([ property, args ])
  } else if (args.length > 1) {
    return B.core.set.has([ B.core.type.set(args), property ])
  } else {
    return B.core.rel.eq([ property, args[0] ])
  }
}

export function invertExpr (op: string, selection: Expression) {
  return B.struct.generator.queryInSelection({
    0: selection, query: B.struct.generator.atomGroups(), 'in-complement': true
  })
}

export function mergeExpr (op: string, s1: Expression, s2: Expression) {
  return B.struct.combinator.merge([s1, s2])
}

export function intersectExpr (op: string, selection: Expression, by: Expression) {
  return B.struct.modifier.intersectBy({ 0: selection, by })
}

export function getPropertyRules(properties: PropertyDict) {
  // in keyof typeof properties
  const propertiesDict: {[name: string]: P.Parser<any>} = {}

  Object.keys(properties).forEach( name => {
    const ps = properties[name]
    const errorFn = makeError(`property '${name}' not supported`)
    const rule = P.regex(ps.regex).map(x => {
      if (ps.isUnsupported) errorFn()
      return testExpr(ps.property, ps.map(x))
    })

    if (!ps.isNumeric) {
      propertiesDict[name] = rule
    }
  })

  return propertiesDict
}

export function getNamedPropertyRules(properties: PropertyDict) {
  const namedPropertiesList: P.Parser<any>[] = []

  Object.keys(properties).forEach( name => {
    const ps = properties[name]
    const errorFn = makeError(`property '${name}' not supported`)
    const rule = P.regex(ps.regex).map(x => {
      if (ps.isUnsupported) errorFn()
      return testExpr(ps.property, ps.map(x))
    })
    const reStr = ps.short ? `${name}|${escapeRegExp(ps.short)}` : `${name}`
    const nameRule = P.regex(RegExp(reStr, 'i')).trim(P.optWhitespace)
    const groupMap = (x: any) => B.struct.generator.atomGroups({[ps.level]: x})

    if (ps.isNumeric) {
      namedPropertiesList.push(
        nameRule.then(P.seq(
          P.regex(/>=|<=|=|!=|>|</).trim(P.optWhitespace),
          P.regex(ps.regex).map(ps.map)
        )).map(x => {
          if (ps.isUnsupported) errorFn()
          return testExpr(ps.property, { op: x[0], val: x[1] })
        }).map(groupMap)
      )
    } else {
      namedPropertiesList.push(nameRule.then(rule).map(groupMap))
    }
  })

  return namedPropertiesList
}

export function getKeywordRules (keywords: KeywordDict) {
  const keywordsList: P.Parser<any>[] = []

  Object.keys(keywords).forEach( name => {
    const ks = keywords[name]
    const reStr = ks.short ? `${name}|${escapeRegExp(ks.short)}` : `${name}`
    const mapFn = ks.map ? ks.map : makeError(`keyword '${name}' not supported`)
    const rule = P.regex(RegExp(reStr, 'i')).map(mapFn)
    keywordsList.push(rule)
  })

  return keywordsList
}
