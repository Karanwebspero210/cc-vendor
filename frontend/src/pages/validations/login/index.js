import * as Yup from 'yup';

const validationSchema = Yup.object({
  email: Yup.string()
    .trim()
    .required('Email is required')
    .matches(
      /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}$/,
      'Please enter a valid email with domain (e.g., ".com", ".net")',
    )
    .test('lowercase-domain', 'Domain must be lowercase (e.g., ".com")', (value) => {
      if (!value) return false;
      const domainPart = value?.split('@')[1];
      return domainPart === domainPart?.toLowerCase();
    }),
  password: Yup.string()
    .min(8, 'Password must be at least 8 characters')
    .matches(
      /^(?=.*[A-Za-z])(?=.*\d).+$/,
      'Password must contain at least one letter and one number',
    )
    .required('Password is required'),
});

export default validationSchema;
