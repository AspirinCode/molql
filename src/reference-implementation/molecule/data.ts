/*
 * Copyright (c) 2017 MolQL contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

import * as mmCIF from './mmcif'
import SpatialLookup from '../utils/spatial-lookup'
import computeBonds from './topology/bonds/compute'
import computeConnectedComponents from './topology/connected-components'
import Rings from './topology/rings/collection'
import { ElementIndex, ElementVdwRadii, DefaultVdwRadius } from './constants'
import { SecondaryStructureFlags, SecondaryStructureMmcif, SecondaryStructurePdb } from './topology/secondary-structure'

export const enum SecondaryStructureType {
    None = 0,
    StructConf = 1,
    StructSheetRange = 2,
}

export const enum BondFlag {
    None                 = 0x0,
    Covalent             = 0x1,
    MetallicCoordination = 0x2,
    Hydrogen             = 0x4,
    Ion                  = 0x8,
    Sulfide              = 0x10,
    Aromatic             = 0x20,
    Computed             = 0x40
    // currently at most 16 flags are supported!!
    // if nore flags needs to be added, _computeBonds in topology/bonds/compute.ts must be updated.
}

export interface Atoms {
    dataIndex: number[],
    residueIndex: number[],
    count: number
}

export interface Residues {
    atomOffset: number[],
    secondaryStructureType: number[],
    secondaryStructureIndex: number[]
    key: number[],
    chainIndex: number[],
    count: number
}

export interface Chains {
    residueOffset: number[],
    entityIndex: number[],
    key: number[],
    count: number
}

export interface Entities {
    chainOffset: number[],
    dataIndex: number[],
    key: number[],
    count: number
}

export interface Bonds {
    /**
     * Where bonds for atom A start and end.
     * Start at idx, end at idx + 1
     */
    offset: number[],
    neighbor: number[],

    order: number[],
    flags: number[],

    count: number
}

export interface Model {
    moleculeId: string,
    id: number,
    data: {
        atom_site: mmCIF.Category<mmCIF.AtomSite>,
        entity: mmCIF.Category<mmCIF.Entity>,
        bonds: {
            structConn: mmCIF.Category<mmCIF.StructConn>,
            chemCompBond: mmCIF.Category<mmCIF.ChemCompBond>
        },
        secondaryStructure: {
            structConf: mmCIF.Category<mmCIF.StructConf>,
            sheetRange: mmCIF.Category<mmCIF.StructSheetRange>
        }
    },
    positions: { x: number[], y: number[], z: number[] },
    atoms: Atoms,
    residues: Residues,
    chains: Chains,
    entities: Entities,

    '@spatialLookup': SpatialLookup | undefined,
    '@connectedComponentKey': number[] | undefined,
    '@bonds': Bonds | undefined,
    '@rings': Rings | undefined
}

export interface Structure {
    id: string,
    models: Model[]
}

export type ElementSymbol = string

const elementSymbolCache: { [value: string]: string } = Object.create(null);
export function ElementSymbol(symbol: any): string {
    let val = elementSymbolCache[symbol];
    if (val) return val;
    val = typeof symbol === 'string' ? symbol.toUpperCase() : `${symbol}`.toUpperCase();
    elementSymbolCache[symbol] = val;
    return val;
}

export function VdwRadius(element: string): number {
    const i = ElementIndex[element];
    return i === void 0 ? DefaultVdwRadius : ElementVdwRadii[i]!
}

export namespace SecondaryStructure {
    function flag(model: Model, residueIndex: number) {
        const type = model.residues.secondaryStructureType[residueIndex]

        let flag = SecondaryStructureType.None;
        switch (type) {
            case SecondaryStructureType.StructConf:
                const index = model.residues.secondaryStructureIndex[residueIndex]
                const helixClass = model.data.secondaryStructure.structConf.pdbx_PDB_helix_class.getString(index)
                if (helixClass !== null) {
                    flag = SecondaryStructurePdb[helixClass]
                } else {
                    const confType = model.data.secondaryStructure.structConf.conf_type_id.getString(index)
                    if (confType !== null) flag = SecondaryStructureMmcif[confType]
                }
                break
            case SecondaryStructureType.StructSheetRange:
                return SecondaryStructureFlags.BetaSheet
        }
        return flag;
    }

    export function checkFlags(model: Model, residueIndex: number, flags: number) {
        const residueFlags = flag(model, residueIndex);
        if (!flags) return residueFlags !== SecondaryStructureType.None;
        return (residueFlags & flags) !== 0;
    }
}

export type ResidueIdentifier = string
export namespace ResidueIdentifier {
    export function auth(chain: string, seq_num: number, ins_code?: string | null): ResidueIdentifier {
        if (ins_code) {
            return `${chain} ${seq_num} ${ins_code}`;
        }
        return `${chain} ${seq_num}`;
    }

    export function label(entity: string, chain: string, seq_num: number, ins_code?: string | null): ResidueIdentifier {
        if (ins_code) {
            return `${entity} ${chain} ${seq_num || '.'} ${ins_code}`;
        }
        return `${entity} ${chain} ${seq_num || '.'}`;
    }

    export function authOfResidueIndex(model: Model, residueIndex: number) {
        const row = model.atoms.dataIndex[model.residues.atomOffset[residueIndex]];
        const { atom_site } = model.data;
        return auth(atom_site.auth_asym_id.getString(row)!, atom_site.auth_seq_id.getInteger(row), atom_site.pdbx_PDB_ins_code.getString(row));
    }

    export function labelOfResidueIndex(model: Model, residueIndex: number) {
        const row = model.atoms.dataIndex[model.residues.atomOffset[residueIndex]];
        const { atom_site } = model.data;
        return label(atom_site.label_entity_id.getString(row)!, atom_site.label_asym_id.getString(row)!, atom_site.label_seq_id.getInteger(row), atom_site.pdbx_PDB_ins_code.getString(row));
    }
}

export namespace Model {
    export function spatialLookup(model: Model): SpatialLookup {
        if (model['@spatialLookup']) return model['@spatialLookup']!;
        const lookup = SpatialLookup(model.positions);
        model['@spatialLookup'] = lookup;
        return lookup;
    }

    export function bonds(model: Model): Bonds {
        if (model['@bonds']) return model['@bonds']!;
        const bonds = computeBonds(model);
        model['@bonds'] = bonds;
        return bonds;
    }

    export function rings(model: Model) {
        if (model['@rings']) return model['@rings']!;
        const rings = Rings(model);
        model['@rings'] = rings;
        return rings;
    }

    export function connectedComponentKey(model: Model): number[] {
        if (model['@connectedComponentKey']) return model['@connectedComponentKey']!;
        const key = computeConnectedComponents(model);
        model['@connectedComponentKey'] = key;
        return key;
    }

    export function findResidueIndexByLabel(model: Model, asymId: string, seqNumber: number, insCode: string | null) {
        const { residueOffset, count: cCount } = model.chains;
        const { atomOffset } = model.residues;
        const { dataIndex } = model.atoms;
        const { label_asym_id, label_seq_id, pdbx_PDB_ins_code } = model.data.atom_site;

        for (let cI = 0; cI < cCount; cI++) {
            let idx = dataIndex[atomOffset[residueOffset[cI]]];
            if (!label_asym_id.stringEquals(idx, asymId)) continue;
            for (let rI = residueOffset[cI], _r = residueOffset[cI + 1]; rI < _r; rI++) {
                idx = dataIndex[atomOffset[rI]];
                if (label_seq_id.getInteger(idx) === seqNumber && (!insCode || pdbx_PDB_ins_code.stringEquals(idx, insCode))) {
                    return rI;
                }
            }
        }
        return -1;
    }

    export function findAtomIndexByLabelName(model: Model, residueIndex: number, atomName: string, altLoc: string | null) {
        const { atomOffset } = model.residues;
        const { dataIndex } = model.atoms;
        const { label_atom_id, label_alt_id } = model.data.atom_site;

        for (let i = atomOffset[residueIndex], _i = atomOffset[residueIndex + 1]; i <= _i; i++) {
            const idx = dataIndex[i];
            if (label_atom_id.stringEquals(idx, atomName) && (!altLoc || label_alt_id.stringEquals(idx, altLoc))) return i;
        }
        return -1;
    }
}

export namespace Bonds {
    export function isCovalent(flags: number) {
        return (flags & BondFlag.Covalent) !== 0;
    }
}