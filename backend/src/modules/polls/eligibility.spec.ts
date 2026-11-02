import { isEligible } from './eligibility.js';

const eng2567 = {
  isChulaVerified: true,
  facultyCode: '21',
  studentYear: 2567,
};

describe('isEligible', () => {
  it('lets anyone answer a public poll', () => {
    expect(
      isEligible('public', [], {
        isChulaVerified: false,
        facultyCode: null,
        studentYear: null,
      }),
    ).toBe(true);
  });

  it('lets only CUNEX-verified users answer a chula poll', () => {
    expect(isEligible('chula', [], eng2567)).toBe(true);
    expect(
      isEligible('chula', [], {
        isChulaVerified: false,
        facultyCode: null,
        studentYear: null,
      }),
    ).toBe(false);
  });

  it('matches faculty-only, year-only and faculty+year rules', () => {
    expect(
      isEligible(
        'restricted',
        [{ facultyCode: '21', studentYear: null }],
        eng2567,
      ),
    ).toBe(true);
    expect(
      isEligible(
        'restricted',
        [{ facultyCode: null, studentYear: 2567 }],
        eng2567,
      ),
    ).toBe(true);
    expect(
      isEligible(
        'restricted',
        [{ facultyCode: '21', studentYear: 2566 }],
        eng2567,
      ),
    ).toBe(false);
  });

  it('ORs rules together', () => {
    expect(
      isEligible(
        'restricted',
        [
          { facultyCode: '30', studentYear: null },
          { facultyCode: '21', studentYear: 2567 },
        ],
        eng2567,
      ),
    ).toBe(true);
  });

  it('never lets unverified accounts into restricted polls', () => {
    expect(
      isEligible('restricted', [{ facultyCode: null, studentYear: 2567 }], {
        ...eng2567,
        isChulaVerified: false,
      }),
    ).toBe(false);
  });

  it('lets only listed, verified accounts into codes polls', () => {
    expect(isEligible('codes', [], eng2567, true)).toBe(true);
    expect(isEligible('codes', [], eng2567, false)).toBe(false);
    expect(
      isEligible('codes', [], { ...eng2567, isChulaVerified: false }, true),
    ).toBe(false);
  });
});
